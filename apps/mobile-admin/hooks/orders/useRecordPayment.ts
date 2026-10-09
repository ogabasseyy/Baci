import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { BASE_URL } from '@/lib/api-client';
import { asyncStorage as AsyncStorage } from '@/lib/storage';
import { safeParseJSON } from '@/lib/validators/storage';
import {
  type ManualPaymentRetry,
  manualPaymentRetrySchema,
} from '@/schemas/manual-payment-retry';
import { generateUUID } from '@/utils/uuid';
import { useMerchant } from '../useMerchant';
import {
  AuthenticatedFetchPreflightError,
  createAuthenticatedFetch,
} from './authenticated-fetch';
import { parseResponsePayload } from './response-utils';

const RECORD_PAYMENT_TIMEOUT_MS = 15_000;
const RECORD_PAYMENT_RETRY_KEY_PREFIX = 'manual-payment-retry:';
const RETRY_STATE_READ_ERROR_MESSAGE =
  'Unable to verify the previous payment attempt. Please try again.';
const RETRY_STATE_WRITE_ERROR_MESSAGE =
  'Unable to secure this payment attempt. Please try again.';
const RETRYABLE_RECORD_PAYMENT_ERROR_CODES = new Set([
  'serialized_inventory_unavailable',
]);

interface PendingIdempotencyKey {
  createdAt: number;
  idempotencyKey: string;
  paymentMethod: string;
  reference: string | null;
}

function isRetryableRecordPaymentError(
  response: Response,
  payload: Record<string, unknown> | string | null
) {
  if (response.status !== 409 || !payload || typeof payload !== 'object') {
    return false;
  }

  const code = typeof payload.code === 'string' ? payload.code : null;
  const error = typeof payload.error === 'string' ? payload.error : null;
  return (
    (code !== null && RETRYABLE_RECORD_PAYMENT_ERROR_CODES.has(code)) ||
    (error !== null && RETRYABLE_RECORD_PAYMENT_ERROR_CODES.has(error))
  );
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  const { merchant } = useMerchant();
  const pendingIdempotencyKeys = useRef(
    new Map<string, PendingIdempotencyKey>()
  );

  return useMutation({
    mutationFn: async ({
      orderId,
      amount,
      paymentMethod,
      reference,
      notes,
    }: {
      amount: number;
      notes?: string;
      orderId: string;
      paymentMethod: string;
      reference?: string;
    }) => {
      const requestFingerprint = JSON.stringify({
        amount,
        orderId,
      });
      const storageKey = `${RECORD_PAYMENT_RETRY_KEY_PREFIX}${orderId}:${encodeURIComponent(requestFingerprint)}`;
      let storedRetry: ManualPaymentRetry | null = null;
      try {
        storedRetry = safeParseJSON(
          await AsyncStorage.getItem(storageKey),
          manualPaymentRetrySchema.nullable(),
          null
        );
      } catch (error) {
        console.error('Failed to read manual payment retry key', error);
        throw new Error(RETRY_STATE_READ_ERROR_MESSAGE);
      }
      const memoryRetry =
        pendingIdempotencyKeys.current.get(requestFingerprint);
      const reusableStoredRetry =
        storedRetry?.fingerprint === requestFingerprint &&
        storedRetry.status === 'pending'
          ? storedRetry
          : null;
      const reusableRetry = memoryRetry ?? reusableStoredRetry;
      const createdAt = reusableRetry?.createdAt || Date.now();
      const idempotencyKey = reusableRetry?.idempotencyKey ?? generateUUID();
      const retryPaymentMethod = reusableRetry?.paymentMethod ?? paymentMethod;
      const retryReference = reusableRetry
        ? (reusableRetry.reference ?? undefined)
        : reference?.trim() || undefined;
      pendingIdempotencyKeys.current.set(requestFingerprint, {
        createdAt,
        idempotencyKey,
        paymentMethod: retryPaymentMethod,
        reference: retryReference ?? null,
      });
      try {
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify({
            createdAt,
            fingerprint: requestFingerprint,
            idempotencyKey,
            paymentMethod: retryPaymentMethod,
            reference: retryReference ?? null,
            status: 'pending',
          })
        );
      } catch (error) {
        pendingIdempotencyKeys.current.delete(requestFingerprint);
        console.error('Failed to persist manual payment retry key', error);
        throw new Error(RETRY_STATE_WRITE_ERROR_MESSAGE);
      }

      const clearRejectedRetry = async () => {
        pendingIdempotencyKeys.current.delete(requestFingerprint);
        try {
          await AsyncStorage.removeItem(storageKey);
        } catch (error) {
          console.error(
            'Failed to clear rejected manual payment retry key',
            error
          );
          try {
            await AsyncStorage.setItem(
              storageKey,
              JSON.stringify({
                createdAt,
                fingerprint: requestFingerprint,
                idempotencyKey,
                paymentMethod: retryPaymentMethod,
                reference: retryReference ?? null,
                status: 'completed',
              })
            );
          } catch (tombstoneError) {
            console.error(
              'Failed to tombstone rejected manual payment retry key',
              tombstoneError
            );
          }
        }
      };

      let response: Response;
      try {
        response = await createAuthenticatedFetch(
          `${BASE_URL}/api/orders/${orderId}/record-payment`,
          {
            body: JSON.stringify({
              amount,
              idempotency_key: idempotencyKey,
              notes: notes?.trim() || undefined,
              payment_method: retryPaymentMethod,
              reference: retryReference,
            }),
            headers: {
              'Content-Type': 'application/json',
              'x-baci-idempotency-required': '1',
            },
            method: 'POST',
          },
          RECORD_PAYMENT_TIMEOUT_MS
        );
      } catch (error) {
        if (
          error instanceof AuthenticatedFetchPreflightError &&
          !reusableRetry
        ) {
          await clearRejectedRetry();
        }
        throw error;
      }

      if (!response.ok) {
        const responseText = await response.text();
        const payload = parseResponsePayload(responseText);
        const isDefinitiveClientError =
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 425, 429].includes(response.status) &&
          !isRetryableRecordPaymentError(response, payload);
        const isAuthRejection = [401, 403].includes(response.status);
        if (isDefinitiveClientError && (!reusableRetry || !isAuthRejection)) {
          await clearRejectedRetry();
        }
        const errorMessage =
          payload &&
          typeof payload === 'object' &&
          typeof payload.error === 'string'
            ? payload.error
            : responseText ||
              `Request failed: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const result = await response.json();
      const reconciledPreviousPayment = result?.idempotency_replayed === true;
      pendingIdempotencyKeys.current.delete(requestFingerprint);
      try {
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify({
            createdAt,
            fingerprint: requestFingerprint,
            idempotencyKey,
            paymentMethod: retryPaymentMethod,
            reference: retryReference ?? null,
            status: 'completed',
          })
        );
      } catch (error) {
        console.error(
          'Failed to mark manual payment retry key completed',
          error
        );
      }
      try {
        await AsyncStorage.removeItem(storageKey);
      } catch (error) {
        console.error('Failed to clear manual payment retry key', error);
      }
      return reconciledPreviousPayment
        ? { ...result, reconciled_previous_payment: true }
        : result;
    },
    mutationKey: ['recordPayment'],
    onSuccess: (_data, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orders', merchant?.id] });
      queryClient.invalidateQueries({
        queryKey: ['order-counts', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['monthly-transaction-count', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['transaction-review', merchant?.id],
      });
      queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-detail'] });
      queryClient.invalidateQueries({ queryKey: ['top-selling-products'] });
      queryClient.invalidateQueries({
        queryKey: ['dashboard-stats', merchant?.id],
      });
    },
  });
}

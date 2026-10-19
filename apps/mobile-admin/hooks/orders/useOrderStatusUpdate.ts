import type { Order, ShippingStatus } from '@baci/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_URL } from '@/lib/api-client';
import { useMerchant } from '../useMerchant';
import {
  AuthenticatedFetchPreflightError,
  createAuthenticatedFetchText,
} from './authenticated-fetch';
import { OrderStatusUpdateError } from './order-status-update-error';
import type { OrdersPage } from './order-types';
import { parseResponsePayload } from './response-utils';

// Shipping includes a bounded tariff check before carrier submission. Keep a
// single deadline across fetch and response parsing, with no automatic retry.
const SHIPMENT_BOOKING_TIMEOUT_MS = 30000;
const ORDER_STATUS_UPDATE_TIMEOUT_MS = 15000;
const IS_DEV_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__;

// These codes can follow submission or an existing/in-flight booking. Some
// (for example ORDER_NOT_FOUND) are shared by pre- and post-submit guards,
// so a typed response alone cannot establish that another booking is safe.
const UNCONFIRMED_SHIPPING_ERROR_CODES = new Set([
  'SHIPMENT_SAVE_FAILED',
  'ORDER_REFUNDED_AFTER_BOOKING',
  'SHIPMENT_BOOKING_STATE_CHECK_FAILED',
  'ORDER_NOT_FOUND',
  'MERCHANT_WALLET_COMPLETION_FAILED',
  'MERCHANT_WALLET_RECONCILIATION_FAILED',
  'MERCHANT_WALLET_SUBMISSION_FAILED',
  'MERCHANT_WALLET_REFUND_FAILED',
  'MERCHANT_WALLET_BOOKING_NOT_RETRYABLE',
  'MERCHANT_WALLET_BOOKED_SHIPMENT_MISSING',
  'SHIPMENT_BOOKING_IN_PROGRESS',
  'SHIPMENT_BOOKING_LOCK_RELEASE_FAILED',
  'EXISTING_SHIPMENT_LOOKUP_FAILED',
  'INCOMPLETE_EXISTING_SHIPMENT',
  'EXISTING_SHIPMENT_PROVIDER_MISMATCH',
  'EXISTING_SHIPMENT_QUOTE_MISMATCH',
]);

// Only errors traced to lookup/validation before carrier submission belong
// here. A new server/proxy code alone does not prove that booking failed.
const DEFINITIVE_PRE_BOOKING_SERVER_ERROR_CODES = new Set([
  'SHIPMENT_BOOKING_LOCK_FAILED',
  'MERCHANT_LOOKUP_FAILED',
  'MERCHANT_SENDER_REQUIRED',
  'QUOTE_ECONOMICS_LOOKUP_FAILED',
  'QUOTE_METADATA_LOOKUP_FAILED',
  'QUOTE_REFRESH_PERSIST_FAILED',
  'QUOTE_REFRESH_ORDER_UPDATE_FAILED',
  'GIGL_AUTHENTICATION_FAILED',
  'GIGL_INTERNATIONAL_COUNTRY_LOOKUP_FAILED',
]);

interface OrderStatusContext {
  previousOrderQueries: [readonly unknown[], Order | undefined][];
  previousOrders: [readonly unknown[], InfiniteData<OrdersPage> | undefined][];
}

interface OrderStatusVariables {
  orderId: string;
  status: ShippingStatus;
}

function unconfirmedShippingResult(): OrderStatusUpdateError {
  return new OrderStatusUpdateError(
    'We could not confirm the shipping result. Check this order’s shipment status before booking again. If it remains unclear, contact support to avoid a duplicate shipment.',
    'SHIPMENT_BOOKING_UNCONFIRMED'
  );
}

async function updateOrderStatus(
  orderId: string,
  status: ShippingStatus
): Promise<Order> {
  const isCancellation = status === 'cancelled';
  const url = `${BASE_URL}/api/orders/${orderId}${isCancellation ? '/cancelled' : ''}`;

  if (IS_DEV_RUNTIME) {
    console.log('[OrderStatus] PATCH start', { orderId, status, url });
  }

  let response: Response;
  let responseText: string;
  try {
    const result = await createAuthenticatedFetchText(
      url,
      {
        body: JSON.stringify({
          ...(isCancellation
            ? { cancelled_by: 'merchant', confirm_cancellation: true }
            : { shipping_status: status }),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: isCancellation ? 'POST' : 'PATCH',
      },
      status === 'shipped'
        ? SHIPMENT_BOOKING_TIMEOUT_MS
        : ORDER_STATUS_UPDATE_TIMEOUT_MS
    );
    response = result.response;
    responseText = result.text;
  } catch (error: unknown) {
    if (IS_DEV_RUNTIME) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[OrderStatus] PATCH request failed', {
        message,
        orderId,
        status,
        url,
      });
    }

    // A lost fetch or response body cannot prove the carrier request failed.
    // Authentication preflight errors are definitive: no request was sent.
    if (
      status === 'shipped' &&
      !(error instanceof AuthenticatedFetchPreflightError)
    ) {
      throw unconfirmedShippingResult();
    }
    throw error;
  }

  const payload = parseResponsePayload(responseText);

  if (!response.ok) {
    const errorCode =
      payload && typeof payload === 'object' && typeof payload.code === 'string'
        ? payload.code
        : undefined;
    // Server failures require reconciliation unless their code proves that
    // submission never began. Shared/post-submit codes stay indeterminate
    // at any HTTP status; preserve other business rejections below.
    if (
      status === 'shipped' &&
      (UNCONFIRMED_SHIPPING_ERROR_CODES.has(errorCode ?? '') ||
        (response.status >= 500 &&
          response.status <= 599 &&
          !DEFINITIVE_PRE_BOOKING_SERVER_ERROR_CODES.has(errorCode ?? '')))
    ) {
      throw unconfirmedShippingResult();
    }
    const errorMessage =
      payload &&
      typeof payload === 'object' &&
      typeof payload.error === 'string'
        ? payload.error
        : responseText ||
          `Request failed: ${response.status} ${response.statusText}`;
    if (IS_DEV_RUNTIME) {
      console.warn('[OrderStatus] PATCH response failed', {
        errorMessage,
        orderId,
        status,
        statusCode: response.status,
        url,
      });
    }

    throw new OrderStatusUpdateError(
      errorMessage,
      errorCode,
      payload && typeof payload === 'object' ? payload : undefined
    );
  }

  if (isCancellation) {
    return { id: orderId, shipping_status: 'cancelled' } as Order;
  }

  const acknowledgedOrder =
    payload &&
    typeof payload === 'object' &&
    payload.order &&
    typeof payload.order === 'object'
      ? payload.order
      : null;
  if (
    status === 'shipped' &&
    (!acknowledgedOrder ||
      !('id' in acknowledgedOrder) ||
      acknowledgedOrder.id !== orderId ||
      !('shipping_status' in acknowledgedOrder) ||
      acknowledgedOrder.shipping_status !== 'shipped')
  ) {
    throw unconfirmedShippingResult();
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !('order' in payload) ||
    !payload.order
  ) {
    throw new Error('Failed to update order status');
  }

  return payload.order as Order;
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { merchant } = useMerchant();

  return useMutation<Order, Error, OrderStatusVariables, OrderStatusContext>({
    mutationFn: ({ orderId, status }) => {
      if (!merchant?.id) {
        throw new Error('Merchant ID is required');
      }

      return updateOrderStatus(orderId, status);
    },
    mutationKey: ['updateOrderStatus'],
    retry: false,
    onError: (_err, _vars, context) => {
      context?.previousOrders?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousOrderQueries?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onMutate: async ({ orderId, status }) => {
      if (!merchant?.id) {
        return { previousOrderQueries: [], previousOrders: [] };
      }

      await queryClient.cancelQueries({ queryKey: ['orders', merchant.id] });
      await queryClient.cancelQueries({ queryKey: ['order', orderId] });

      const previousOrders = queryClient.getQueriesData<
        InfiniteData<OrdersPage>
      >({
        queryKey: ['orders', merchant.id],
      });

      queryClient.setQueriesData<InfiniteData<OrdersPage>>(
        { queryKey: ['orders', merchant.id] },
        (old) => {
          if (!old?.pages) {
            return old;
          }

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              orders: page.orders.map((order) =>
                order.id === orderId
                  ? { ...order, shipping_status: status }
                  : order
              ),
            })),
          };
        }
      );

      const previousOrderQueries = queryClient.getQueriesData<Order>({
        queryKey: ['order', orderId],
      });

      queryClient.setQueriesData<Order>(
        { queryKey: ['order', orderId] },
        (old) => {
          if (!old) {
            return old;
          }

          return { ...old, shipping_status: status };
        }
      );

      return { previousOrderQueries, previousOrders };
    },
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({ queryKey: ['orders', merchant?.id] });
      queryClient.invalidateQueries({ queryKey: ['order', vars.orderId] });
      queryClient.invalidateQueries({
        queryKey: ['transaction-review', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['monthly-transaction-count', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['dashboard-stats', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['order-counts', merchant?.id],
      });
    },
  });
}

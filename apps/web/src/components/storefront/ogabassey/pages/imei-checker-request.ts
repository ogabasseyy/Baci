import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  DEFAULT_IMEI_CHECK_ERROR_MESSAGE,
  resolveImeiCheckFailure,
} from './imei-checker-resolve-failure';
import type { ImeiResult } from './imei-checker-types';

const currencyFormatter = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  maximumFractionDigits: 0,
  style: 'currency',
});

interface ImeiCheckOutcome {
  result: ImeiResult | null;
  error: string | null;
  keepRequestIdentity: boolean;
  lookupId: string | null;
  needsWalletFunding: boolean;
  needsSignIn: boolean;
  pending: { lookupId: string; pollAfterMs: number } | null;
}

interface ImeiApiPayload {
  balance?: number;
  code?: string;
  data?: ImeiResult;
  error?: string;
  lookupId?: string;
  pollAfterMs?: number;
  required?: number;
  status?: 'complete' | 'error' | 'pending';
  success?: boolean;
}

export type ImeiPollOutcome =
  | { kind: 'complete'; lookupId: string | null; result: ImeiResult }
  | { error: string; kind: 'error' }
  | { kind: 'pending'; pollAfterMs: number }
  | { kind: 'retry'; pollAfterMs: number };

function describeCheckFailure(
  outcome: ReturnType<typeof resolveImeiCheckFailure>
): string {
  if (outcome.errorMessage !== null) {
    return outcome.errorMessage;
  }

  if (outcome.shouldRedirectToLogin) {
    return 'Please sign in to check this device.';
  }

  if (outcome.topUpAmount !== null) {
    return `Insufficient wallet balance. You need ${currencyFormatter.format(outcome.topUpAmount)} more to run this check.`;
  }

  return DEFAULT_IMEI_CHECK_ERROR_MESSAGE;
}

export async function performImeiCheck(
  imei: string,
  tier: ImeiServiceTierKey,
  tierPrice: number,
  idempotencyKey: string,
  merchantSlug: string,
  device?: ImeiDeviceCategory
): Promise<ImeiCheckOutcome> {
  try {
    const response = await fetchWithCsrf('/api/storefront/imei-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        clientCapabilities: ['imei-async-v1'],
        ...(device ? { device } : {}),
        imei,
        merchantSlug,
        tier,
      }),
    });

    const data = (await response.json()) as ImeiApiPayload;

    if (
      response.status === 202 &&
      data.success === true &&
      data.status === 'pending' &&
      data.lookupId
    ) {
      return {
        error: null,
        keepRequestIdentity: true,
        lookupId: data.lookupId,
        needsSignIn: false,
        needsWalletFunding: false,
        pending: {
          lookupId: data.lookupId,
          pollAfterMs: data.pollAfterMs ?? 2_000,
        },
        result: null,
      };
    }

    if (!response.ok || !data.success) {
      const outcome = resolveImeiCheckFailure({
        currentTierPrice: tierPrice,
        payload: data,
        responseStatus: response.status,
        walletBalance: 0,
      });

      return {
        result: null,
        error: describeCheckFailure(outcome),
        keepRequestIdentity: outcome.shouldPreserveIdempotencyKey,
        lookupId: null,
        needsSignIn: outcome.shouldRedirectToLogin,
        needsWalletFunding:
          response.status === 402 && data.code === 'WALLET_INSUFFICIENT',
        pending: null,
      };
    }

    return {
      result: data.data ?? null,
      error: null,
      keepRequestIdentity: false,
      lookupId: data.lookupId ?? null,
      needsSignIn: false,
      needsWalletFunding: false,
      pending: null,
    };
  } catch (error) {
    console.error('IMEI check failed:', error);
    return {
      result: null,
      error: 'Network error. Please check your connection and try again.',
      keepRequestIdentity: true,
      lookupId: null,
      needsSignIn: false,
      needsWalletFunding: false,
      pending: null,
    };
  }
}

export async function pollImeiCheck(
  lookupId: string,
  merchantSlug: string
): Promise<ImeiPollOutcome> {
  try {
    const response = await fetchWithCsrf(
      `/api/storefront/imei-check/${encodeURIComponent(lookupId)}?merchantSlug=${encodeURIComponent(merchantSlug)}`,
      { method: 'GET' }
    );
    const data = (await response.json()) as ImeiApiPayload;
    if (
      response.status === 202 &&
      data.success === true &&
      data.status === 'pending'
    ) {
      return { kind: 'pending', pollAfterMs: data.pollAfterMs ?? 5_000 };
    }
    if (
      response.ok &&
      data.success === true &&
      data.status === 'complete' &&
      data.data
    ) {
      return {
        kind: 'complete',
        lookupId: data.lookupId ?? null,
        result: data.data,
      };
    }
    return {
      error: data.error || DEFAULT_IMEI_CHECK_ERROR_MESSAGE,
      kind: 'error',
    };
  } catch (error) {
    console.error('IMEI status poll failed:', error);
    return { kind: 'retry', pollAfterMs: 10_000 };
  }
}

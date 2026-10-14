import type { CartErrorCode } from '@baci/shared/cart';

import { fetchWithCsrf } from '@/lib/api-client';
import { cartRoute, failureOf, isRecord, readBody } from './shared-cart-client';

export interface SharedCartCheckoutReview {
  checkoutSessionId: string;
  generation: number;
  cartVersion: number;
  cartId: string;
  merchantId: string;
  subtotalMinor: number;
  currency: string;
  unavailableCount: number;
}

export type PrepareSharedCartCheckoutResult =
  | {
      ok: true;
      review: SharedCartCheckoutReview;
      replayed: boolean;
      sessionReused: boolean;
    }
  | {
      ok: false;
      code: CartErrorCode;
      retryable: boolean;
      currentVersion: number | null;
    };

export function reviewOf(value: unknown): SharedCartCheckoutReview | null {
  if (!isRecord(value)) return null;
  const estimates = value.estimates;
  if (
    typeof value.checkoutSessionId !== 'string' ||
    typeof value.generation !== 'number' ||
    !Number.isInteger(value.generation) ||
    typeof value.cartVersion !== 'number' ||
    !Number.isInteger(value.cartVersion) ||
    typeof value.cartId !== 'string' ||
    typeof value.merchantId !== 'string' ||
    !isRecord(estimates) ||
    typeof estimates.subtotalMinor !== 'number' ||
    typeof estimates.currency !== 'string' ||
    typeof estimates.unavailableCount !== 'number'
  ) {
    return null;
  }
  return {
    cartId: value.cartId,
    cartVersion: value.cartVersion,
    checkoutSessionId: value.checkoutSessionId,
    currency: estimates.currency,
    generation: value.generation,
    merchantId: value.merchantId,
    subtotalMinor: estimates.subtotalMinor,
    unavailableCount: estimates.unavailableCount,
  };
}

/**
 * Reviews the authoritative cart for checkout. Returns the session
 * reference the order submit binds to; version drift fails with the
 * live version so the caller refreshes instead of submitting stale.
 */
export async function prepareSharedCartCheckout(
  input: {
    cartId: string;
    expectedVersion: number;
    operationId: string;
  },
  merchantSlug?: string | null
): Promise<PrepareSharedCartCheckoutResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart/checkout', merchantSlug),
      {
        body: JSON.stringify({
          cartId: input.cartId,
          expectedVersion: input.expectedVersion,
          operationId: input.operationId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
  } catch {
    return {
      code: 'temporarily_unavailable',
      currentVersion: null,
      ok: false,
      retryable: true,
    };
  }
  const body = await readBody(response);
  if (response.ok && body) {
    const review = reviewOf(body.snapshot);
    if (review) {
      return {
        ok: true,
        replayed: body.replayed === true,
        review,
        sessionReused: body.sessionReused === true,
      };
    }
    return {
      code: 'temporarily_unavailable',
      currentVersion: null,
      ok: false,
      retryable: true,
    };
  }
  const failure = failureOf(body, response.status);
  return {
    code: failure.code,
    currentVersion:
      body && typeof body.currentVersion === 'number'
        ? body.currentVersion
        : null,
    ok: false,
    retryable: failure.retryable,
  };
}

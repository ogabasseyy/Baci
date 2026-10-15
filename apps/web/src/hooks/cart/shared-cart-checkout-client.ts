import type { CartErrorCode } from '@baci/shared/cart';

import { fetchWithCsrf } from '@/lib/api-client';
import type { CartCheckoutLine } from '@/lib/cart/checkout-snapshot';
import { parseSnapshot } from '@/lib/cart/checkout-snapshot';
import type { CartItem } from './cart-types';
import { cartRoute, failureOf, readBody } from './shared-cart-client';

export interface SharedCartCheckoutReview {
  checkoutSessionId: string;
  generation: number;
  cartVersion: number;
  cartId: string;
  merchantId: string;
  subtotalMinor: number;
  currency: string;
  unavailableCount: number;
  lines: CartCheckoutLine[];
}

/**
 * Rebuilds order inputs from the authoritative review: product shells
 * (name, image) stay local, while identity, quantity, price, negotiation
 * and assurance come from the reviewed lines. Returns null when a
 * reviewed line has no display shell, which means the display cart is
 * stale and must refresh instead of submitting.
 */
export function reviewedCheckoutItems(
  display: readonly (CartItem & { serverLineId?: string | null })[],
  review: SharedCartCheckoutReview
): CartItem[] | null {
  const items: CartItem[] = [];
  for (const line of review.lines) {
    const shell = display.find((item) => item.serverLineId === line.id);
    if (!shell) return null;
    items.push({
      ...shell,
      condition: (line.condition as CartItem['condition']) ?? shell.condition,
      hasAssurance: line.hasAssurance,
      assuranceRate: line.assuranceRate ?? shell.assuranceRate,
      negotiatedPrice:
        line.negotiationStatus === 'accepted' &&
        !line.negotiationInvalidated &&
        line.negotiatedUnitPriceMinor !== null
          ? line.negotiatedUnitPriceMinor / 100
          : undefined,
      negotiationStatus:
        !line.negotiationInvalidated &&
        (line.negotiationStatus === 'accepted' ||
          line.negotiationStatus === 'pending' ||
          line.negotiationStatus === 'rejected')
          ? line.negotiationStatus
          : undefined,
      price: line.validatedUnitPriceMinor / 100,
      quantity: line.quantity,
      quizAwardId: line.voucherAwardId ?? shell.quizAwardId,
      quizVoucherToken: line.voucherToken ?? shell.quizVoucherToken,
      variantAttributes: { ...line.options },
      variantId: line.variantId ?? shell.variantId,
    });
  }
  return items;
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
  const snapshot = parseSnapshot(value);
  if (!snapshot) return null;
  return {
    cartId: snapshot.cartId,
    cartVersion: snapshot.cartVersion,
    checkoutSessionId: snapshot.checkoutSessionId,
    currency: snapshot.estimates.currency,
    generation: snapshot.generation,
    lines: snapshot.lines,
    merchantId: snapshot.merchantId,
    subtotalMinor: snapshot.estimates.subtotalMinor,
    unavailableCount: snapshot.estimates.unavailableCount,
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

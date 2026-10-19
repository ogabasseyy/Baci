// Redirect-handoff retirement for the retained loyalty checkout key.
//
// Loyalty checkout keys survive the payment handoff so an abandoned
// BNPL popup or blocked gateway redirect can replay the claimed
// order. A full-page redirect gateway (Paystack) ends that story on
// the success page, which has no checkout session left to clear the
// key: without retirement, a repeated identical purchase inside the
// TTL replays the already-paid order instead of creating a new one.
//
// prepareCheckout records { orderId, keyInput } in sessionStorage at
// redirect handoff. The success page retires the key only after the
// public order-tracking endpoint confirms that exact order is paid:
// reaching the page proves nothing by itself, because the snapshot
// and this record are written at order creation — an abandoned
// gateway visit followed by a direct /checkout/success navigation
// must keep the key (and its replay of the claimed order) intact.
import type { LegacyCheckoutKeyInput } from './build-legacy-checkout-fingerprint';
import { clearLegacyCheckoutIdempotencyKey } from './clear-legacy-checkout-idempotency-key';

export const LEGACY_CHECKOUT_REDIRECT_PENDING_KEY =
  'baci:legacy-checkout-redirect-pending';

const PENDING_REDIRECT_TTL_MS = 24 * 60 * 60 * 1000;

interface PendingLegacyRedirect {
  orderId: string;
  keyInput: LegacyCheckoutKeyInput;
  createdAt: number;
}

export function recordLegacyCheckoutRedirect(
  orderId: string,
  keyInput: LegacyCheckoutKeyInput
): void {
  try {
    const pending: PendingLegacyRedirect = {
      orderId,
      keyInput,
      createdAt: Date.now(),
    };
    window.sessionStorage.setItem(
      LEGACY_CHECKOUT_REDIRECT_PENDING_KEY,
      JSON.stringify(pending)
    );
  } catch {
    // Storage unavailable: the key simply retains its normal TTL.
  }
}

function readPendingLegacyRedirect(): PendingLegacyRedirect | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingLegacyRedirect>;
    if (
      typeof parsed.orderId !== 'string' ||
      parsed.orderId.length === 0 ||
      typeof parsed.createdAt !== 'number' ||
      !parsed.keyInput ||
      typeof parsed.keyInput !== 'object'
    ) {
      return null;
    }
    return parsed as PendingLegacyRedirect;
  } catch {
    return null;
  }
}

function removePendingLegacyRedirect(): void {
  try {
    window.sessionStorage.removeItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY);
  } catch {
    // The key decision is already made; a stale record cannot
    // resurrect a retired key.
  }
}

async function fetchConfirmedPaid(order: {
  orderId: string;
  email: string;
  merchantSlug: string;
}): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      order_id: order.orderId,
      email: order.email,
      merchant_slug: order.merchantSlug,
    });
    const response = await fetch(
      `/api/storefront/orders/track-order?${params.toString()}`
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      order?: { payment_status?: unknown };
    };
    return body.order?.payment_status === 'paid';
  } catch {
    // Unverifiable right now: keep the key. A later confirmed visit
    // can still retire it within the TTL.
    return false;
  }
}

export async function retireLegacyCheckoutRedirectWhenPaid(input: {
  orderId: string | null | undefined;
  email: string | null | undefined;
  merchantSlug: string | null | undefined;
}): Promise<boolean> {
  if (!input.orderId) return false;
  const pending = readPendingLegacyRedirect();
  if (!pending) return false;
  const expired = Date.now() - pending.createdAt > PENDING_REDIRECT_TTL_MS;
  if (pending.orderId !== input.orderId || expired) {
    if (expired) removePendingLegacyRedirect();
    return false;
  }
  if (!input.email || !input.merchantSlug) return false;
  const paid = await fetchConfirmedPaid({
    orderId: input.orderId,
    email: input.email,
    merchantSlug: input.merchantSlug,
  });
  if (!paid) return false;
  await clearLegacyCheckoutIdempotencyKey(pending.keyInput);
  removePendingLegacyRedirect();
  return true;
}

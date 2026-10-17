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
// redirect handoff; the success page retires the key only when its
// confirmed order snapshot matches the recorded order. Abandoned or
// failed attempts never reach the success page, so their key (and
// replay) survives.
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

export async function retireLegacyCheckoutRedirectForOrder(
  orderId: string | null | undefined
): Promise<boolean> {
  if (!orderId) return false;
  const pending = readPendingLegacyRedirect();
  if (!pending) return false;
  const expired = Date.now() - pending.createdAt > PENDING_REDIRECT_TTL_MS;
  if (pending.orderId !== orderId || expired) {
    if (expired) {
      try {
        window.sessionStorage.removeItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY);
      } catch {
        // Nothing else to clean up.
      }
    }
    return false;
  }
  await clearLegacyCheckoutIdempotencyKey(pending.keyInput);
  try {
    window.sessionStorage.removeItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY);
  } catch {
    // The key is retired; a stale record cannot resurrect it.
  }
  return true;
}

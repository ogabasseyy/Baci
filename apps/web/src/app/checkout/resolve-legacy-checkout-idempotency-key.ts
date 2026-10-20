// Persisted Idempotency-Key resolution for the legacy checkout page.
//
// The loyalty order wrapper can only replay a committed create when
// the request carries a checkout idempotency key; without one, a
// response lost after commit leaves the shopper retrying into
// loyalty_code_already_used against an order that already exists (and
// dropping the code can then duplicate the order). Whenever a discount
// code is applied, the legacy page resolves the same persisted,
// fingerprint-scoped key the storefront checkout uses: a retry of the
// same checkout replays the original order. Resolution throws when
// browser storage is unavailable, so loyalty callers fail the submit
// closed rather than risk a duplicate against a single-use code.
//
// Two tabs submitting before a key exists would each mint their own
// (the shared helper's read-mint-store is not atomic), so resolution
// runs inside a Web Lock when available; without locks it re-reads
// after a short settle and adopts whichever key survived in storage.
import { getCheckoutIdempotencyKey } from '@/components/storefront/ogabassey/pages/checkout/checkout-idempotency';
import {
  buildLegacyCheckoutFingerprint,
  type LegacyCheckoutKeyInput,
} from './build-legacy-checkout-fingerprint';

const SETTLE_DELAY_MS = 25;

function lockManager(): { request: LockManager['request'] } | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

function settleDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
}

export async function resolveLegacyCheckoutIdempotencyKey(
  input: LegacyCheckoutKeyInput
): Promise<string> {
  const fingerprint = buildLegacyCheckoutFingerprint(input);
  const locks = lockManager();
  if (locks) {
    try {
      return await locks.request('legacy-checkout-idempotency', () =>
        getCheckoutIdempotencyKey(fingerprint)
      );
    } catch {
      // Locks threw mid-flight: fall through to the settle re-read.
    }
  }
  const first = await getCheckoutIdempotencyKey(fingerprint);
  await settleDelay();
  try {
    return await getCheckoutIdempotencyKey(fingerprint);
  } catch {
    return first;
  }
}

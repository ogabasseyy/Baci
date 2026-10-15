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
// browser storage is unavailable, so the caller fails the submit
// closed rather than risk a duplicate against a single-use code.
import { getCheckoutIdempotencyKey } from '@/components/storefront/ogabassey/pages/checkout/checkout-idempotency';
import {
  buildLegacyCheckoutFingerprint,
  type LegacyCheckoutKeyInput,
} from './build-legacy-checkout-fingerprint';

export function resolveLegacyCheckoutIdempotencyKey(
  input: LegacyCheckoutKeyInput
): Promise<string> {
  return getCheckoutIdempotencyKey(buildLegacyCheckoutFingerprint(input));
}

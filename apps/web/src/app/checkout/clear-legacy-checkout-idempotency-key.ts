// Retires the legacy checkout idempotency key after a completed
// checkout. Reusable merchant codes must not replay the previous
// order when the same buyer repeats the same cart inside the shared
// 24h TTL, so completion rotates the key away; the in-flight attempt
// keeps its key (lost-response replay) because clearing only happens
// once the create response has been received and handed off.
import { clearCheckoutIdempotencyKey } from '@/components/storefront/ogabassey/pages/checkout/checkout-idempotency';
import {
  buildLegacyCheckoutFingerprint,
  type LegacyCheckoutKeyInput,
} from './build-legacy-checkout-fingerprint';

export function clearLegacyCheckoutIdempotencyKey(
  input: LegacyCheckoutKeyInput
): Promise<void> {
  return clearCheckoutIdempotencyKey(buildLegacyCheckoutFingerprint(input));
}

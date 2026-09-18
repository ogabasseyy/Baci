/**
 * Activation threshold: 5% of the quoted device price, rounded up. Pure
 * math only: no provider calls, no storage, no network.
 */
import { assertPositiveKobo } from './kobo-validators';
import {
  ACTIVATION_RATIO_DENOMINATOR,
  ACTIVATION_RATIO_NUMERATOR,
} from './savings-policy-constants';

export function activationThresholdKobo(quotedPriceKobo: number): number {
  assertPositiveKobo(quotedPriceKobo, 'quotedPriceKobo');
  return Math.ceil(
    (quotedPriceKobo * ACTIVATION_RATIO_NUMERATOR) /
      ACTIVATION_RATIO_DENOMINATOR
  );
}

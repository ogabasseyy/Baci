/**
 * Activation threshold: 5% of the quoted device price, rounded up. Pure
 * math only: no provider calls, no storage, no network.
 */
import { assertPositiveKobo } from './assert-positive-kobo';
import {
  ACTIVATION_RATIO_DENOMINATOR,
  ACTIVATION_RATIO_NUMERATOR,
} from './savings-policy-constants';

export function activationThresholdKobo(quotedPriceKobo: number): number {
  assertPositiveKobo(quotedPriceKobo, 'quotedPriceKobo');
  // Divide before multiplying: the naive price*NUMERATOR intermediate
  // exceeds MAX_SAFE_INTEGER near the upper boundary and rounds the
  // threshold up by one kobo. Both partial products stay in safe range
  // because the quotient is at most the (safe) price and the remainder is
  // below the denominator.
  const quotient = Math.floor(quotedPriceKobo / ACTIVATION_RATIO_DENOMINATOR);
  const remainder = quotedPriceKobo % ACTIVATION_RATIO_DENOMINATOR;
  return (
    quotient * ACTIVATION_RATIO_NUMERATOR +
    Math.ceil(
      (remainder * ACTIVATION_RATIO_NUMERATOR) / ACTIVATION_RATIO_DENOMINATOR
    )
  );
}

/**
 * Plan activation: confirmed contributions meet the 5% threshold of the
 * quoted device price.
 */
import { activationThresholdKobo } from './activation-threshold-kobo';
import { assertKobo } from './assert-kobo';
import { assertPositiveKobo } from './assert-positive-kobo';

export function isActivated(
  confirmedContributionKobo: number,
  quotedPriceKobo: number
): boolean {
  assertKobo(confirmedContributionKobo, 'confirmedContributionKobo');
  assertPositiveKobo(quotedPriceKobo, 'quotedPriceKobo');
  return confirmedContributionKobo >= activationThresholdKobo(quotedPriceKobo);
}

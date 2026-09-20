/**
 * Applicable device price: the lower of the guaranteed and current prices,
 * with a live protected offer acting as one more ceiling until expiry. A
 * live offer never overrides a still-lower catalogue price (early readiness
 * covers the lower of guaranteed/current for the identical device).
 * Decides only from confirmed amounts, never from pending accrual or
 * client claims.
 */
import { assertPositiveKobo } from './assert-positive-kobo';
import { assertValidDate } from './assert-valid-date';

export function applicablePriceKobo(args: {
  guaranteedPriceKobo: number;
  currentPriceKobo: number;
  protectedOfferPriceKobo?: number;
  protectedOfferExpiresAt?: Date;
  now?: Date;
}): number {
  assertPositiveKobo(args.guaranteedPriceKobo, 'guaranteedPriceKobo');
  assertPositiveKobo(args.currentPriceKobo, 'currentPriceKobo');
  const now = args.now ?? new Date();
  const offerPrice = args.protectedOfferPriceKobo;
  const offerExpiry = args.protectedOfferExpiresAt;
  // A half-persisted offer (price without expiry, or vice versa) is
  // corrupted financial state: silently ignoring it would discard an
  // otherwise lower customer price, so fail closed instead of falling
  // back to the (possibly higher) guaranteed/current price.
  if (
    (offerPrice === undefined && offerExpiry !== undefined) ||
    (offerPrice !== undefined && offerExpiry === undefined)
  ) {
    throw new RangeError(
      'protectedOfferPriceKobo and protectedOfferExpiresAt must both be present or both absent'
    );
  }
  if (offerPrice !== undefined && offerExpiry !== undefined) {
    // An invalid expiry or comparison instant must fail closed instead of
    // silently discarding the customer's price protection: comparing
    // against an invalid Date is always false and would fall through to
    // the (possibly higher) guaranteed/current price.
    assertValidDate(offerExpiry, 'protectedOfferExpiresAt');
    assertValidDate(now, 'now');
    if (now <= offerExpiry) {
      assertPositiveKobo(offerPrice, 'protectedOfferPriceKobo');
      return Math.min(
        offerPrice,
        args.guaranteedPriceKobo,
        args.currentPriceKobo
      );
    }
  }
  return Math.min(args.guaranteedPriceKobo, args.currentPriceKobo);
}

/**
 * Applicable device price: a live protected offer wins until expiry, then
 * the lower of the guaranteed and current prices. Decides only from
 * confirmed amounts, never from pending accrual or client claims.
 */
import { assertPositiveKobo, assertValidDate } from './kobo-validators';

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
  if (
    args.protectedOfferPriceKobo !== undefined &&
    args.protectedOfferExpiresAt !== undefined
  ) {
    // An invalid expiry or comparison instant must fail closed instead of
    // silently discarding the customer's price protection: comparing
    // against an invalid Date is always false and would fall through to
    // the (possibly higher) guaranteed/current price.
    assertValidDate(args.protectedOfferExpiresAt, 'protectedOfferExpiresAt');
    assertValidDate(now, 'now');
    if (now <= args.protectedOfferExpiresAt) {
      assertPositiveKobo(
        args.protectedOfferPriceKobo,
        'protectedOfferPriceKobo'
      );
      return args.protectedOfferPriceKobo;
    }
  }
  return Math.min(args.guaranteedPriceKobo, args.currentPriceKobo);
}

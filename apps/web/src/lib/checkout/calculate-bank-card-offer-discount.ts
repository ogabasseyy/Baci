/** Calculate a capped merchandise discount using half-up rounding in kobo. */
export function calculateBankCardOfferDiscount(
  eligibleSubtotalKobo: bigint,
  discountBasisPoints: number,
  maximumDiscountKobo: number
): bigint {
  const basisPoints = 10_000n;
  const rounded =
    (eligibleSubtotalKobo * BigInt(discountBasisPoints) + basisPoints / 2n) /
    basisPoints;
  const cap = BigInt(maximumDiscountKobo);
  return rounded < cap ? rounded : cap;
}

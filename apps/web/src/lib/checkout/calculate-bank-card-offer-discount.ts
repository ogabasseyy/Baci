/** Calculate a capped merchandise discount using half-up rounding in kobo. */
export function calculateBankCardOfferDiscount(
  eligibleSubtotalKobo: bigint,
  discountBasisPoints: number,
  maximumDiscountKobo: number
): bigint {
  if (
    eligibleSubtotalKobo <= 0n ||
    !Number.isSafeInteger(discountBasisPoints) ||
    discountBasisPoints < 1 ||
    discountBasisPoints >= 10_000 ||
    !Number.isSafeInteger(maximumDiscountKobo) ||
    maximumDiscountKobo < 1
  ) {
    return 0n;
  }

  const basisPoints = 10_000n;
  const rounded =
    (eligibleSubtotalKobo * BigInt(discountBasisPoints) + basisPoints / 2n) /
    basisPoints;
  const cap = BigInt(maximumDiscountKobo);
  return rounded < cap ? rounded : cap;
}

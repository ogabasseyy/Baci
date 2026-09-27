/**
 * Whether a model-granted Santa price fits the server-computed per-product
 * discount ceiling. Integer comparison avoids float rounding at exact
 * boundaries (e.g. a true 2% grant must not fail a 2% ceiling).
 */
export function isSantaGrantedPriceWithinCeiling(
  catalogPrice: number,
  grantedPrice: number,
  maxDiscountPercentage: number
): boolean {
  if (
    !(catalogPrice > 0) ||
    grantedPrice < 0 ||
    !(maxDiscountPercentage >= 0)
  ) {
    return false;
  }
  return (
    (catalogPrice - grantedPrice) * 100 <= maxDiscountPercentage * catalogPrice
  );
}

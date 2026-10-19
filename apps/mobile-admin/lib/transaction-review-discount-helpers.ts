export const DISCOUNT_TOLERANCE = 0.01;

export function getProductVariantIdentity(
  productId: unknown,
  variantId: unknown
): string | null {
  if (
    typeof productId !== 'string' ||
    productId.trim().length === 0 ||
    (variantId !== null && typeof variantId !== 'string')
  ) {
    return null;
  }

  return JSON.stringify([productId, variantId ?? null]);
}

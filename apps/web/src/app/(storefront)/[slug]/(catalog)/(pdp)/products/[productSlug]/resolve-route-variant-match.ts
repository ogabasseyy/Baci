type VariantIdentityLike = { id: string };

/**
 * Honored route variant id: the link param names one of the product's own
 * hydrated variants and the shopper has not explicitly picked past it.
 */
export function matchRouteVariantId(
  variantIdParam: string | null | undefined,
  ignoredRouteVariantId: string | null,
  variants: VariantIdentityLike[] | undefined
): string | null {
  return variantIdParam &&
    variantIdParam !== ignoredRouteVariantId &&
    variants?.some((variant) => String(variant.id) === variantIdParam)
    ? variantIdParam
    : null;
}

/**
 * Exact-match contract (mirrors the route offer match): a nonempty link
 * variant id absent from the hydrated variants means the option was
 * removed or sold — surface it as missing instead of silently falling
 * back to the default variant (which can advertise and charge a
 * different, higher price). An explicit shopper pick
 * (ignoredRouteVariantId) clears the missing state: they deliberately
 * moved past the dead link. Only hydrated variant arrays count, so a
 * product that never loads variants keeps the legacy silent path.
 */
export function isRouteVariantMissing(
  variantIdParam: string | null | undefined,
  ignoredRouteVariantId: string | null,
  variants: VariantIdentityLike[] | undefined
): boolean {
  return (
    Boolean(variantIdParam) &&
    variantIdParam !== ignoredRouteVariantId &&
    Array.isArray(variants) &&
    !variants.some((variant) => String(variant.id) === variantIdParam)
  );
}

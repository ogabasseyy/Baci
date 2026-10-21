import {
  coerceOfferAuthorityRow,
  type ResolvedOfferResolution,
} from '@baci/shared/lib';

/**
 * Authority rows eligible for MCP discovery surfaces: coercible,
 * canonically matching the caller product, carrying a finite price,
 * and passing the conservative parent-shape ad-gate (checkout would
 * stage unshaped parents, but discovery does not advertise them).
 * Shared by the detail and variants resolvers so a policy change can
 * never update only one surface.
 */
export function selectMcpOfferResolutions(
  rows: unknown,
  productId: string
): ResolvedOfferResolution[] {
  if (!Array.isArray(rows)) return [];
  const canonicalProductId = productId.toLowerCase();
  return rows.flatMap((row) => {
    const resolution = coerceOfferAuthorityRow(row);
    if (
      !resolution ||
      resolution.productId !== canonicalProductId ||
      resolution.priceBasis === null ||
      resolution.parentEligible !== true
    )
      return [];
    return [resolution];
  });
}

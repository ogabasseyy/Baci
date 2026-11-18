import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Order-independently verifies that every caller-supplied product entry
 * resolved to a non-ID product slug in `entries` + `resolvedSlugs`, so omitting
 * merchant-wide PDP detail and redirect tags cannot leave archived, deleted, or
 * unenumerated ID-only entries stale.
 */
export function hasCompleteScopedProductSlugs(
  products: readonly InternalRevalidateProductEntry[],
  entries: readonly StorefrontProductPurgeEntry[],
  resolvedSlugs: readonly string[]
): boolean {
  if (products.length === 0 || entries.length < products.length) {
    return false;
  }

  const entrySlugSet = new Set(
    entries.map((entry) => entry.slug.trim()).filter(Boolean)
  );
  const resolvedSet = new Set(
    resolvedSlugs.map((slug) => slug.trim()).filter(Boolean)
  );
  const callerSlugs = new Set<string>();
  const idOnlyProductIds = new Set<string>();

  for (const product of products) {
    const callerSlug = product.slug?.trim();
    const productId = product.id?.trim();

    if (callerSlug) {
      if (!entrySlugSet.has(callerSlug) || !resolvedSet.has(callerSlug)) {
        return false;
      }
      callerSlugs.add(callerSlug);
    } else if (productId) {
      if (entrySlugSet.has(productId)) {
        return false;
      }
      idOnlyProductIds.add(productId);
    } else {
      return false;
    }
  }

  if (idOnlyProductIds.size === 0) {
    return true;
  }

  const resolvedAuthoritySlugs = Array.from(entrySlugSet).filter(
    (slug) => !idOnlyProductIds.has(slug) && resolvedSet.has(slug)
  );
  const additionalResolvedCount = resolvedAuthoritySlugs.filter(
    (slug) => !callerSlugs.has(slug)
  ).length;

  return additionalResolvedCount >= idOnlyProductIds.size;
}

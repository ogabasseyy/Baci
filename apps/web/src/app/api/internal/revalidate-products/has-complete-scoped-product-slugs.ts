import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Returns true only when every caller-supplied product entry resolved to a
 * non-ID product slug in `entries` + `resolvedSlugs`, so omitting
 * merchant-wide PDP detail and redirect tags cannot leave archived, deleted, or
 * unenumerated ID-only entries stale.
 */
export function hasCompleteScopedProductSlugs(
  products: readonly InternalRevalidateProductEntry[],
  entries: readonly StorefrontProductPurgeEntry[],
  resolvedSlugs: readonly string[]
): boolean {
  if (entries.length < products.length) {
    return false;
  }

  const resolvedSet = new Set(
    resolvedSlugs.map((slug) => slug.trim()).filter(Boolean)
  );
  let resolvedCount = 0;

  for (const [index, product] of products.entries()) {
    const entrySlug = entries[index]?.slug?.trim();
    const callerSlug = product.slug?.trim();
    const productId = product.id?.trim();

    if (!entrySlug || !resolvedSet.has(entrySlug)) {
      return false;
    }
    if (!callerSlug && productId && entrySlug === productId) {
      return false;
    }
    resolvedCount += 1;
  }

  return resolvedCount === products.length;
}

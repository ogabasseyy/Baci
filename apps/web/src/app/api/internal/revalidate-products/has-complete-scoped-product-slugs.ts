import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Verifies per-entry that every caller-supplied product resolved cleanly in
 * `entries` and `resolvedSlugs`, checking each ID-only product against
 * `authoritativeSlugsById` directly so extra entries or counts cannot mask an
 * unresolved product.
 */
export function hasCompleteScopedProductSlugs(
  products: readonly InternalRevalidateProductEntry[],
  entries: readonly StorefrontProductPurgeEntry[],
  resolvedSlugs: readonly string[],
  authoritativeSlugsById?: ReadonlyMap<string, string>
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

  for (const product of products) {
    const callerSlug = product.slug?.trim();
    const productId = product.id?.trim();

    if (callerSlug) {
      if (!entrySlugSet.has(callerSlug) || !resolvedSet.has(callerSlug)) {
        return false;
      }
      continue;
    }

    if (!productId) {
      return false;
    }

    const authoritativeSlug = authoritativeSlugsById?.get(productId)?.trim();
    if (
      !authoritativeSlug ||
      authoritativeSlug === productId ||
      !entrySlugSet.has(authoritativeSlug) ||
      !resolvedSet.has(authoritativeSlug)
    ) {
      return false;
    }
  }

  return true;
}

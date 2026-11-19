import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Verifies per-entry that every caller-supplied product resolved cleanly in
 * `entries` and `resolvedSlugs`, pairing each product's `id` to its own
 * `authoritativeSlugsById` entry so permutations or stale caller slugs cannot
 * mask an unresolved product. Slug-bearing entries must also supply
 * `previousSlug` (`string` on renames, `null` when verified unchanged) because
 * post-write DB enrichment only sees the current slug.
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
    const previousSlug = product.previousSlug?.trim();
    const productId = product.id?.trim();
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

    if (callerSlug) {
      if (
        product.previousSlug === undefined ||
        callerSlug !== authoritativeSlug ||
        !entrySlugSet.has(callerSlug) ||
        !resolvedSet.has(callerSlug)
      ) {
        return false;
      }
    }

    if (
      previousSlug &&
      (!entrySlugSet.has(previousSlug) || !resolvedSet.has(previousSlug))
    ) {
      return false;
    }
  }

  return true;
}

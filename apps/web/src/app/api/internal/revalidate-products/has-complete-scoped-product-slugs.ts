import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Verifies per-entry that every caller-supplied product resolved cleanly in
 * `entries` and `resolvedSlugs`, checking each ID-only product against
 * `authoritativeSlugsById` directly so extra entries or counts cannot mask an
 * unresolved product. Callers that may rename slugs must include `previousSlug`
 * (or omit `omitMerchantWidePdpDetails`), because post-write DB enrichment only
 * sees the current slug.
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

    if (
      callerSlug &&
      (!entrySlugSet.has(callerSlug) || !resolvedSet.has(callerSlug))
    ) {
      return false;
    }

    if (
      previousSlug &&
      (!entrySlugSet.has(previousSlug) || !resolvedSet.has(previousSlug))
    ) {
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

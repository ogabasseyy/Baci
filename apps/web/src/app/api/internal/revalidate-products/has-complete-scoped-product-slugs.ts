import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

export interface HasCompleteScopedProductSlugsOptions {
  /**
   * Only for order/inventory-only callers (e.g. checkout/order cancellations)
   * where product slugs cannot be renamed by the operation. Never set for
   * generic product-save or import routes.
   */
  allowAssumedUnchangedSlugs?: boolean;
}

/**
 * Verifies per-entry that every caller-supplied product resolved cleanly in
 * `entries` and `resolvedSlugs`, pairing each product's `id` to its own
 * normalized `authoritativeSlugsById` entry so permutations or stale caller
 * slugs cannot mask an unresolved product. By default requires a non-empty
 * `previousSlug` on every product (failing closed on ID-only or `null` claims)
 * unless `allowAssumedUnchangedSlugs` is explicitly set for order-stock purges.
 */
export function hasCompleteScopedProductSlugs(
  products: readonly InternalRevalidateProductEntry[],
  entries: readonly StorefrontProductPurgeEntry[],
  resolvedSlugs: readonly string[],
  authoritativeSlugsById?: ReadonlyMap<string, string>,
  options?: HasCompleteScopedProductSlugsOptions
): boolean {
  if (products.length === 0 || entries.length < products.length) {
    return false;
  }

  const entrySlugSet = new Set(
    entries.map((entry) => entry.slug.trim().toLowerCase()).filter(Boolean)
  );
  const resolvedSet = new Set(
    resolvedSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean)
  );

  for (const product of products) {
    const callerSlug = product.slug?.trim().toLowerCase();
    const previousSlug = product.previousSlug?.trim().toLowerCase();
    const productId = product.id?.trim();
    if (!productId) {
      return false;
    }

    const authoritativeSlug = authoritativeSlugsById
      ?.get(productId)
      ?.trim()
      .toLowerCase();
    if (
      !authoritativeSlug ||
      authoritativeSlug === productId.toLowerCase() ||
      !entrySlugSet.has(authoritativeSlug) ||
      !resolvedSet.has(authoritativeSlug)
    ) {
      return false;
    }

    if (!options?.allowAssumedUnchangedSlugs && !previousSlug) {
      return false;
    }

    if (
      callerSlug &&
      (callerSlug !== authoritativeSlug ||
        !entrySlugSet.has(callerSlug) ||
        !resolvedSet.has(callerSlug))
    ) {
      return false;
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

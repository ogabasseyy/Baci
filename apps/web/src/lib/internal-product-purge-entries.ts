import {
  resolveProductPurgeCategorySegment,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Convert the flat product entries accepted by the internal revalidate-products
 * contract (and the user-authed `/api/cache/revalidate` route) into
 * `StorefrontProductPurgeEntry[]` for a Cloudflare purge.
 *
 * - Falls back to the product `id` when the slug is missing (legacy null-slug
 *   rows stay addressable at `/products/<id>`).
 * - Derives the canonical PDP category segment from the caller's `category`
 *   (legacy text) / `categorySlug` (resolved join slug) hints, matching the
 *   storefront canonical. Callers pass flat data, so there is no junction embed
 *   here — a caller that knows the joined category passes its `categorySlug`.
 */
export function buildInternalProductPurgeEntries(
  products: readonly InternalRevalidateProductEntry[],
  /**
   * Authoritative category segments keyed by product id, resolved server-side
   * from the product ROW (direct join → text → junction). When present for a
   * product, it overrides the caller's flat hints — a mobile caller only knows
   * the legacy text, which the canonical join may supersede.
   */
  authoritativeSegmentsById?: ReadonlyMap<string, string | null>,
  /**
   * Authoritative slugs keyed by product id (from the same server-side row
   * lookup): an {id}-only entry for a product that HAS a slug must purge the
   * actually-cached /products/<slug> URL, not the rarely-cached UUID path.
   */
  authoritativeSlugsById?: ReadonlyMap<string, string>
): StorefrontProductPurgeEntry[] {
  const entries: StorefrontProductPurgeEntry[] = [];
  for (const product of products) {
    const id = product.id?.trim();
    const slug =
      product.slug?.trim() ||
      (id ? authoritativeSlugsById?.get(id)?.trim() : undefined) ||
      id;
    if (!slug) {
      continue;
    }
    const authoritative = id ? authoritativeSegmentsById?.get(id) : undefined;
    const resolveCategorySegment = (targetSlug: string) =>
      authoritative !== undefined
        ? authoritative
        : resolveProductPurgeCategorySegment({
            slug: targetSlug,
            category: product.category ?? null,
            category_slug: product.categorySlug ?? null,
          });
    entries.push({
      slug,
      categorySegment: resolveCategorySegment(slug),
    });
    const previousSlug = product.previousSlug?.trim();
    if (previousSlug && previousSlug !== slug) {
      entries.push({
        slug: previousSlug,
        categorySegment: resolveCategorySegment(previousSlug),
      });
    }
  }
  return entries;
}

/**
 * Collect the DISTINCT slug-values under which the given products' per-slug Next
 * product-detail cache (`getProductScopedCacheTag('product', merchantId, slug)`,
 * used by `getCachedProductWithDetails`/`getCachedProductLcpHint`/…) may be tagged, so a
 * caller can bust those tags BEFORE scheduling the Cloudflare purge — otherwise a
 * CF MISS refills the edge from the still-cached, still-tagged Next entry until
 * its cacheLife TTL, defeating the purge.
 *
 * Per product this yields, deduplicated:
 * - the AUTHORITATIVE row slug (when server-resolved) — the slug the storefront
 *   actually serves the PDP under, so the one the Next entry is tagged with;
 * - the CALLER-provided slug — busts the OLD tag on a slug rename (both survive);
 * - the id — legacy null-slug rows are served (and cached/tagged) at
 *   `/products/<id>`, so the id doubles as a slug for tagging.
 */
export function collectResolvedProductSlugs(
  products: readonly InternalRevalidateProductEntry[],
  authoritativeSlugsById?: ReadonlyMap<string, string>
): string[] {
  const slugs = new Set<string>();
  for (const product of products) {
    const id = product.id?.trim();
    const authoritativeSlug = id
      ? authoritativeSlugsById?.get(id)?.trim()
      : undefined;
    if (authoritativeSlug) {
      slugs.add(authoritativeSlug);
    }
    const callerSlug = product.slug?.trim();
    if (callerSlug) {
      slugs.add(callerSlug);
    }
    const previousSlug = product.previousSlug?.trim();
    if (previousSlug) {
      slugs.add(previousSlug);
    }
    if (id) {
      slugs.add(id);
    }
  }
  return Array.from(slugs);
}

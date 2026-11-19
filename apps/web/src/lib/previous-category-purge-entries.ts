import {
  resolveProductPurgeCategorySegment,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Collect the distinct, non-blank `previousCategoryId` hints from the entries so
 * their category slugs can be batch-resolved server-side (mobile only knows the
 * id, never the slug) before building the old-category purge entries.
 */
export function collectPreviousCategoryIds(
  products: readonly InternalRevalidateProductEntry[]
): string[] {
  const ids = new Set<string>();
  for (const product of products) {
    const previousCategoryId = product.previousCategoryId?.trim();
    if (previousCategoryId) {
      ids.add(previousCategoryId);
    }
  }
  return Array.from(ids);
}

/**
 * A category MOVE leaves the OLD category's `/<oldSlug>` listing and
 * `/<oldSlug>/<productSlug>` canonical PDP cached against this product. Mobile
 * saves persist only `category_id` (the legacy text can be blank), so the old
 * SEGMENT often cannot be derived from the caller's flat text hint — the route
 * resolves the old category's slug from `previousCategoryId` server-side and
 * passes it here as `previousCategorySlugById`.
 *
 * For each product whose resolved OLD segment differs from its CURRENT
 * authoritative segment, emit a hint-only purge entry (`{ slug, oldSegment }`)
 * so the stale old listing + old canonical PDP are evicted. Emits nothing when:
 * the old segment is unresolved (lookup miss → fail open onto the caller's flat
 * hints), the product resolves to no slug/id, or the old segment equals the
 * current segment (no real move). CDN paths are case-sensitive, so the segment
 * comparison is exact.
 */
export function buildPreviousCategoryPurgeEntries(
  products: readonly InternalRevalidateProductEntry[],
  previousCategorySlugById: ReadonlyMap<string, string>,
  authoritativeSegmentsById?: ReadonlyMap<string, string | null>,
  authoritativeSlugsById?: ReadonlyMap<string, string>
): StorefrontProductPurgeEntry[] {
  const entries: StorefrontProductPurgeEntry[] = [];
  for (const product of products) {
    const previousCategoryId = product.previousCategoryId?.trim();
    if (!previousCategoryId) {
      continue;
    }
    const oldSegment = previousCategorySlugById.get(previousCategoryId)?.trim();
    if (!oldSegment) {
      continue;
    }
    const id = product.id?.trim();
    const slug =
      product.slug?.trim() ||
      (id ? authoritativeSlugsById?.get(id)?.trim() : undefined) ||
      id;
    if (!slug) {
      continue;
    }
    // The product's CURRENT authoritative segment — the SAME value the primary
    // purge entry uses (server-resolved row segment when known, else the flat
    // caller hints). Skip when it equals the old segment: the product did not
    // actually move, so the old location is not stale.
    const authoritative = id ? authoritativeSegmentsById?.get(id) : undefined;
    const currentSegment =
      (authoritative !== undefined
        ? authoritative
        : resolveProductPurgeCategorySegment({
            slug,
            category: product.category ?? null,
            category_slug: product.categorySlug ?? null,
          })
      )?.trim() ?? null;
    if (currentSegment === oldSegment) {
      continue;
    }
    entries.push({ slug, categorySegment: oldSegment });
    const previousSlug = product.previousSlug?.trim();
    if (previousSlug && previousSlug !== slug) {
      entries.push({ slug: previousSlug, categorySegment: oldSegment });
    }
  }
  return entries;
}

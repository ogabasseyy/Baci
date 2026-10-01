import { getProductUrl } from '@/lib/seo-utils';
import {
  dedupePathSegmentsPreservingCasing,
  resolvePurgeHostnames,
} from '@/lib/storefront-purge-shared';
import { resolveStorefrontProductPurgeCategorySlug } from './storefront-product-purge-category';

// Past this many DISTINCT product purge targets in one operation, use the
// bounded hostname-wide Cloudflare purge instead of URL-by-URL fan-out. That
// evicts every affected PDP (plus other public documents for this storefront)
// while remaining bounded by the configured aliases. Shared by every
// product-purge caller; compare `countDistinctProductPurgeEntries`.
export const PURGE_WHOLE_STOREFRONT_THRESHOLD = 50;

// Cloudflare accepts at most 30 URL targets per request on non-Enterprise
// plans. Keep post-response invalidation bounded to ten batches; if product
// and related-article targets exceed this count, callers should use the
// hostname-wide purge instead of starting an unbounded tail of requests.
export const PURGE_WHOLE_STOREFRONT_URL_THRESHOLD = 300;

/**
 * One product's purge target: its slug plus the canonical category segment of
 * its PDP (e.g. `smartphones`), or null when the product resolves to the
 * `/products/<slug>` fallback path (no category). Derive `categorySegment`
 * with `resolveProductPurgeCategorySegment` so it matches the URL the
 * storefront actually serves.
 */
export interface StorefrontProductPurgeEntry {
  /** Product slug — original casing preserved (the CDN path is case-sensitive). */
  slug: string;
  categorySegment?: string | null;
}

interface ProductPurgeCategoryInput {
  slug?: string | null;
  name?: string | null;
  category?: string | null;
  categories?: {
    is_active?: boolean | null;
    name?: string;
    slug?: string;
  } | null;
  category_slug?: string | null;
}

/**
 * Derive the canonical category segment for a product's PDP purge URL by
 * reusing the SAME resolution `getProductUrl` performs for the storefront
 * canonical (active direct category join → active junction → legacy text),
 * then reading the leading path segment of the resolved path.
 *
 * Returns null when the product resolves to the `/products/<slug>` fallback
 * (no category) so callers only emit the fallback PDP URL. NEVER throws: any
 * failure resolving the URL yields null, so building a purge target can never
 * break the mutation path that schedules it.
 */
export function resolveProductPurgeCategorySegment(
  product: ProductPurgeCategoryInput
): string | null {
  try {
    const slug = product.slug?.trim();
    if (!slug) {
      return null;
    }

    const path = getProductUrl({
      id: '',
      name: product.name ?? '',
      slug,
      category: product.category ?? null,
      categories: product.categories ?? null,
      category_slug: product.category_slug ?? null,
      // Ignore any stored canonical_url: the derived slug/category path is the
      // URL the PDP canonicalizes to and edge-caches (getValidatedProductUrl
      // discards a divergent canonical_url), so it is the correct purge target.
      canonical_url: null,
    });

    const [firstSegment] = path.split('/').filter(Boolean);
    if (!firstSegment || firstSegment.toLowerCase() === 'products') {
      return null;
    }
    return firstSegment;
  } catch {
    return null;
  }
}

/**
 * The raw PostgREST product row shape a purge caller reads to resolve a PDP's
 * canonical category segment: the legacy text column plus the direct
 * `category_id` join and the `product_categories` junction embeds.
 */
export interface ProductPurgeCategoryRow {
  slug?: string | null;
  /**
   * Product id — the URL path segment (`/products/<id>`, `/<category>/<id>`) for
   * legacy rows whose slug is null/blank, so it is the EFFECTIVE slug fallback
   * when resolving the category segment below.
   */
  id?: string | null;
  name?: string | null;
  category?: string | null;
  /** `categories:category_id(slug, is_active)` embed (object | array | null). */
  categories?: unknown;
  /** `product_categories(category_id, categories(slug, is_active))` embed. */
  product_categories?: unknown;
}

/**
 * Resolve a product's canonical PDP category segment from a raw product row,
 * applying the SAME precedence the storefront canonical uses
 * (`normalizeJoinedCategory`, PR #2914): the direct `category_id` join wins,
 * then the active `product_categories` junction, and finally the legacy text.
 * Without this, a product whose direct category was retired would purge the
 * stale legacy URL while the storefront serves it under the active relation
 * category, leaving the canonical PDP cache un-purged. Never throws.
 */
export function resolveProductPurgeCategorySegmentForRow(
  row: ProductPurgeCategoryRow
): string | null {
  const joinedSlug = resolveStorefrontProductPurgeCategorySlug({
    categories: row.categories,
    productCategories: row.product_categories,
  });
  const joinedCategory = joinedSlug ? { slug: joinedSlug } : null;
  // Legacy rows can carry a null/blank slug but stay addressable by id
  // (`/products/<id>`, `/<category>/<id>`), so resolve the segment against the
  // EFFECTIVE slug (id fallback). Without it, a null slug short-circuits
  // `resolveProductPurgeCategorySegment` to null BEFORE the join is considered,
  // dropping the categorized PDP + category listing from the purge. Passing the
  // id is safe: `getProductUrl` only uses the slug as the URL path segment,
  // which IS the id for these rows.
  const effectiveSlug = row.slug?.trim() || row.id;
  return resolveProductPurgeCategorySegment({
    slug: effectiveSlug,
    name: row.name,
    category: row.category,
    categories: joinedCategory,
  });
}

function dedupeProductPurgeEntries(
  entries: readonly StorefrontProductPurgeEntry[]
): Array<{ slug: string; categorySegment: string | null }> {
  const seen = new Set<string>();
  const deduped: Array<{ slug: string; categorySegment: string | null }> = [];
  for (const entry of entries) {
    const slug = entry.slug?.trim();
    if (!slug) {
      continue;
    }
    const rawSegment = entry.categorySegment?.trim() ?? '';
    // Dedupe by the EXACT (slug, segment) pair: CDN paths are case-sensitive,
    // so case-only-distinct entries are distinct cached URLs (e.g. a case-only
    // rename queues old + new) and BOTH must survive to be purged.
    const key = `${slug}|${rawSegment}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({ slug, categorySegment: rawSegment || null });
  }
  return deduped;
}

/**
 * Count the DISTINCT purge targets in `entries`, deduped by the exact
 * `${slug}|${segment}` pair — the SAME key `dedupeProductPurgeEntries` (and thus
 * `buildStorefrontProductPurgeUrls`) collapses on. The hostname-purge fallback
 * threshold MUST use this, never `entries.length`: an import sheet with repeated
 * rows for one product (or callers that fan a product into several entries)
 * would otherwise escalate a small, well-under-budget change unnecessarily.
 */
export function countDistinctProductPurgeEntries(
  entries: readonly StorefrontProductPurgeEntry[]
): number {
  return dedupeProductPurgeEntries(entries).length;
}

/**
 * Build the canonical public URLs to evict from Cloudflare when a storefront's
 * products change. For every resolved hostname of a matched storefront this
 * emits, per affected product: the canonical PDP `/<category>/<slug>` (when the
 * category is known) and the always-valid fallback `/products/<slug>`; plus,
 * once per hostname, each affected category listing `/<category>`, the
 * all-products listing `/products`, and the home page `/` (all list products).
 * Storefronts without a public cache policy resolve to no hostnames and return
 * an empty list (purge is a no-op).
 *
 */
export function buildStorefrontProductPurgeUrls(
  identifiers: readonly string[],
  entries: readonly StorefrontProductPurgeEntry[],
  blogPostSlugs: readonly string[] = []
): string[] {
  const dedupedEntries = dedupeProductPurgeEntries(entries);
  if (dedupedEntries.length === 0) {
    return [];
  }

  const categorySegments = dedupePathSegmentsPreservingCasing(
    dedupedEntries
      .map((entry) => entry.categorySegment ?? '')
      .filter((segment): segment is string => segment.length > 0)
  );
  const normalizedBlogPostSlugs =
    dedupePathSegmentsPreservingCasing(blogPostSlugs);

  const urls = new Set<string>();
  for (const identifier of identifiers) {
    for (const hostname of resolvePurgeHostnames(identifier)) {
      // The storefront home lists products, so any product mutation can change
      // it — evict it once per hostname.
      urls.add(`https://${hostname}/`);
      // The all-products listing (/products) is a cacheable public document
      // rendered from the product index, so any create / delete / status change
      // can leave it stale — evict it once per hostname too.
      urls.add(`https://${hostname}/products`);

      for (const entry of dedupedEntries) {
        // The canonical categorized PDP is the URL the storefront serves 200
        // for (mismatched paths 308 away), so evict it when the category is
        // known.
        if (entry.categorySegment) {
          urls.add(
            `https://${hostname}/${encodeURIComponent(
              entry.categorySegment
            )}/${encodeURIComponent(entry.slug)}`
          );
        }
        // The `/products/<slug>` fallback PDP path resolves for every product
        // regardless of category, so always evict it.
        urls.add(
          `https://${hostname}/products/${encodeURIComponent(entry.slug)}`
        );
      }

      // Category listing pages list their products, so a product entering,
      // leaving, or changing within a category must evict them.
      for (const segment of categorySegments) {
        urls.add(`https://${hostname}/${encodeURIComponent(segment)}`);
      }

      // Related-product cards are embedded in the cached article document,
      // not only in the product PDP. Purge the blog index and each affected
      // published article (plus its generated social image) when a linked
      // product changes. Keep this list caller-supplied and bounded to avoid
      // evicting unrelated blog content on every catalog mutation.
      if (normalizedBlogPostSlugs.length > 0) {
        urls.add(`https://${hostname}/blog`);
        for (const slug of normalizedBlogPostSlugs) {
          urls.add(`https://${hostname}/blog/${encodeURIComponent(slug)}`);
          urls.add(
            `https://${hostname}/blog/${encodeURIComponent(slug)}/opengraph-image`
          );
        }
      }
    }
  }

  return Array.from(urls);
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublishedBlogPostSlugsForProducts } from '@/lib/get-published-blog-post-slugs-for-products';
import {
  buildInternalProductPurgeEntries,
  collectResolvedProductSlugs,
} from '@/lib/internal-product-purge-entries';
import {
  buildPreviousCategoryPurgeEntries,
  collectPreviousCategoryIds,
} from '@/lib/previous-category-purge-entries';
import {
  type ProductPurgeCategoryRow,
  resolveProductPurgeCategorySegmentForRow,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

export interface AuthoritativeProductPurgeEnrichment {
  /**
   * All Cloudflare purge entries: the primary per-product entry (authoritative
   * server-resolved category segment when known, else the caller's flat hints)
   * plus, for category moves, the OLD-location hint entries.
   */
  entries: StorefrontProductPurgeEntry[];
  /**
   * Distinct slug-values (authoritative row slug, caller slug, and id) under
   * which the affected products' per-slug Next product-detail cache is tagged.
   * Callers pass these to `revalidateProductSlugs` BEFORE scheduling the edge
   * purge so a CF MISS cannot refill from stale Next-cached product data.
   */
  resolvedSlugs: string[];
  /** Published article slugs whose related-product rail embeds these products. */
  blogPostSlugs: string[];
}

/**
 * Resolve authoritative Cloudflare purge entries for a set of flat product
 * revalidate entries, using a Supabase client to look up the products' real
 * rows (so an `{id}`-only or join-categorized entry purges the actual
 * slug/category URLs instead of `/products/<uuid>`).
 *
 * Shared by `/api/cache/revalidate` (user-authed SSR client — RLS lets a
 * merchant read all its own products, incl. drafts, via `has_merchant_access`)
 * and `/api/internal/revalidate-products` (service-role client — the anon
 * `products_select_policy` only exposes ACTIVE rows, so a draft/pending product
 * save/import would otherwise fail to resolve). The DB reads are merchant-scoped
 * either way. Fail-open: a lookup error logs and falls back to the caller's flat
 * hints — a survivable purge must never break the revalidation.
 */
export async function enrichProductPurgeEntries(
  supabase: SupabaseClient,
  merchantId: string,
  products: readonly InternalRevalidateProductEntry[]
): Promise<AuthoritativeProductPurgeEnrichment> {
  // Resolve authoritative category segments + slugs from the product ROWS so a
  // join-categorized or {id}-only product purges its real canonical path even
  // when the caller only knows the legacy text hint / uuid.
  const idsToResolve = products
    .map((product) => product.id?.trim())
    .filter((id): id is string => Boolean(id));
  const authoritativeSegmentsById = new Map<string, string | null>();
  const authoritativeSlugsById = new Map<string, string>();
  if (idsToResolve.length > 0) {
    const { data: productRows, error: productRowsError } = await supabase
      .from('products')
      .select(
        'id, slug, name, category, categories:category_id(slug, is_active), product_categories(category_id, categories(slug, is_active))'
      )
      .eq('merchant_id', merchantId)
      .in('id', idsToResolve);
    if (productRowsError) {
      // Fail-open: log and fall through — with no authoritative rows the purge
      // still fires from the caller's flat category hints below.
      console.error(
        'Failed to resolve authoritative product rows for Cloudflare product purge (continuing with caller hints):',
        { merchantId, error: productRowsError }
      );
    }
    for (const row of productRows ?? []) {
      const typedRow = row as unknown as ProductPurgeCategoryRow & {
        id: string;
      };
      authoritativeSegmentsById.set(
        typedRow.id,
        resolveProductPurgeCategorySegmentForRow(typedRow)
      );
      if (typedRow.slug?.trim()) {
        authoritativeSlugsById.set(typedRow.id, typedRow.slug.trim());
      }
    }
  }

  const primaryEntries = buildInternalProductPurgeEntries(
    products,
    authoritativeSegmentsById,
    authoritativeSlugsById
  );

  // A category MOVE persisted by id carries only the NEW `category_id`; the OLD
  // category's `/<oldSlug>` listing + canonical `/<oldSlug>/<slug>` PDP stay
  // cached against this product. Resolve those ids to slugs here (ONE
  // merchant-scoped query) and append hint-only purge entries for products whose
  // OLD segment differs from the current one.
  const previousCategoryIds = collectPreviousCategoryIds(products);
  const previousCategorySlugById = new Map<string, string>();
  if (previousCategoryIds.length > 0) {
    const { data: categoryRows, error: categoryRowsError } = await supabase
      .from('categories')
      .select('id, slug')
      .eq('merchant_id', merchantId)
      .in('id', previousCategoryIds);
    if (categoryRowsError) {
      // Fail-open: log and continue — an unresolved old segment simply skips the
      // OLD-location purge; the CURRENT-location purge still fires and the stale
      // old page self-heals on its TTL.
      console.error(
        'Failed to resolve previous category slugs for Cloudflare product purge (continuing without old-segment purge):',
        { merchantId, error: categoryRowsError }
      );
    }
    for (const row of categoryRows ?? []) {
      const typedRow = row as {
        id?: string | null;
        slug?: string | null;
      };
      const categoryId = typedRow.id?.trim();
      const categorySlug = typedRow.slug?.trim();
      if (categoryId && categorySlug) {
        previousCategorySlugById.set(categoryId, categorySlug);
      }
    }
  }

  const entries = [
    ...primaryEntries,
    ...buildPreviousCategoryPurgeEntries(
      products,
      previousCategorySlugById,
      authoritativeSegmentsById,
      authoritativeSlugsById
    ),
  ];

  const blogPostSlugs =
    idsToResolve.length > 0 || entries.length > 0
      ? await getPublishedBlogPostSlugsForProducts(
          supabase,
          merchantId,
          idsToResolve,
          entries
            .map((entry) => entry.categorySegment)
            .filter((segment): segment is string => Boolean(segment))
        )
      : [];

  return {
    entries,
    resolvedSlugs: collectResolvedProductSlugs(
      products,
      authoritativeSlugsById
    ),
    blogPostSlugs,
  };
}

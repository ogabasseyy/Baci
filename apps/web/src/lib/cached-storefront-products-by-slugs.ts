import { cacheLife, cacheTag } from 'next/cache';
import {
  getPublicSupabaseClient,
  hydrateAndSanitizeProducts,
  type StorefrontHomeProduct,
} from '@/lib/cached-data';

/**
 * Same column list as `getCachedStorefrontHomeProducts`'s base select, so rows
 * are shape-compatible with `mapHomeProductsToTemplateProducts`. Includes the
 * `categories:category_id` FK join (like the home "recent" select) so a pinned
 * product whose category lives only on `category_id` — with no
 * `product_categories` M2M row — still resolves a category for its PDP deep-link
 * instead of falling back to the category-less `/products/<slug>` path.
 */
const PRODUCTS_BY_SLUG_SELECT = `
      id, name, slug, description, price, compare_at_price, created_at,
      images, category, brand, condition, has_condition_offers, stock, stock_quantity,
      manage_stock, low_stock_threshold,
      categories:category_id(id, name, slug, parent_id),
      product_categories(categories(name, slug))
    `;

type StorefrontProductBySlug = StorefrontHomeProduct & {
  product_key_specs?: unknown;
};

const PRODUCT_FILTER_SPECS_SELECT =
  'product_key_specs(ram_gb, storage_gb, gpu, available_colors, sim_type, display_type, screen_size_inches)';

interface StorefrontProductsBySlugsQuery
  extends PromiseLike<{
    data: StorefrontProductBySlug[] | null;
    error: unknown;
  }> {
  eq(column: string, value: unknown): StorefrontProductsBySlugsQuery;
  in(column: string, values: readonly string[]): StorefrontProductsBySlugsQuery;
}

interface StorefrontProductsBySlugsTable {
  select(columns: string): StorefrontProductsBySlugsQuery;
}

/**
 * Deterministically fetch specific active products by slug for the current
 * merchant, regardless of any recency/handset candidate window.
 *
 * The home "recent" feed is capped (top-50 mixed window), so explicitly-pinned
 * launch devices can fall outside it. This targeted `.in('slug', …)` query
 * guarantees they're available to merge into the launch carousel before
 * selection and JSON-LD slicing. Cached + tagged like the other home product
 * queries so `revalidateProducts()` busts it too.
 */
export async function getCachedStorefrontProductsBySlugs(
  merchantId: string,
  slugs: readonly string[],
  includeFilterSpecs = false
): Promise<StorefrontProductBySlug[]> {
  // PR4b review (Codex, PR #3108): stays `'use cache: remote'`. This reader
  // feeds the pinned launch carousel, and its freshness contract depends on
  // revalidateProducts() tag busting reaching EVERY instance — local
  // 'use cache' entries only see same-instance revalidation, so a demotion
  // would serve stale pinned products after merchant edits until cacheLife
  // expiry. Bounded payload + low-cardinality key make it a legitimate KEEP;
  // it joins the PR4d resilient-adapter migration set (inventory doc §8).
  'use cache: remote';
  cacheLife('products');
  cacheTag(
    'products',
    `products-${merchantId}`,
    `products-by-slugs-${merchantId}`
  );

  if (slugs.length === 0) {
    return [];
  }

  const supabase = getPublicSupabaseClient();
  const productsTable = supabase.from(
    'products'
  ) as unknown as StorefrontProductsBySlugsTable;
  const { data, error } = await productsTable
    .select(
      includeFilterSpecs
        ? `${PRODUCTS_BY_SLUG_SELECT}, ${PRODUCT_FILTER_SPECS_SELECT}`
        : PRODUCTS_BY_SLUG_SELECT
    )
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .in('slug', slugs);

  if (error) {
    console.error('Failed to load storefront products by slug', {
      merchantId,
      error,
    });
    throw error;
  }

  return hydrateAndSanitizeProducts(supabase, merchantId, data ?? []);
}

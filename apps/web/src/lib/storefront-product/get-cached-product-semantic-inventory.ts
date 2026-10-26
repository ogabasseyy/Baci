import { getPublicSupabaseClient } from '@/lib/cached-data';
import { PRODUCT_KEY_SPECS_RELATION_SELECT } from '@/lib/product-key-specs-select';
import type { ProductSemanticCandidate } from '@/lib/storefront-product/product-semantic-types';

/**
 * Upper bound for the EXACT-category semantic-link inventory below.
 *
 * This exact-slug function feeds the compare-GRAPH consumers (related-compare
 * links, category compare links). Compare PAGES resolve via
 * getCachedCompareCategoryInventory, capped at
 * COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT (600). A graph link is only useful
 * if the compare page it points at can resolve both products, so this bound
 * MUST stay <= that cap — otherwise, in a category with more active products
 * than the cap, graph links for the overflow rows would point at compare URLs
 * whose products are not in the compare-page inventory (404/noindex).
 *
 * Kept at 300 (largest exact-slug category for ogabassey is `laptops` = 293),
 * comfortably under the 600 compare-page cap. The category+children scoped
 * variant (getCachedCategoryScopedSemanticInventory) uses its OWN, separately
 * aligned bound — see CATEGORY_SCOPED_SEMANTIC_INVENTORY_LIMIT there.
 */
export const PRODUCT_SEMANTIC_INVENTORY_LIMIT = 300;

// This is an OPTIONAL overlay read (related compare links + a maintained-slug
// indexability signal). Bound it tightly and degrade gracefully: the compare
// page renders fully without it. See the retry note on the query below for why
// an unbounded read here cost ~34s per compare render.
export const PRODUCT_SEMANTIC_INVENTORY_TIMEOUT_MS = 3_000;

export interface ProductSemanticInventoryCategoryJoin {
  categories?:
    | { slug?: string | null }
    | Array<{ slug?: string | null }>
    | null;
}

export interface ProductSemanticInventoryRow {
  brand?: string | null;
  condition?: string | null;
  name?: string | null;
  price?: number | string | null;
  product_categories?: ProductSemanticInventoryCategoryJoin[] | null;
  product_key_specs?:
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null;
  slug?: string | null;
  stock?: number | null;
  stock_quantity?: number | null;
  is_parent?: boolean | null;
  parent_product_id?: string | null;
}

/**
 * Product-column projection shared by the exact-slug inventory (this file) and
 * the category+children scoped variant. The `product_categories` embed differs
 * between the two (exact-slug filters on categories.slug; the scoped variant
 * filters on category_id), so each composes its own join clause onto this base.
 */
export const PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT = `
  slug,
  name,
  price,
  brand,
  condition,
  stock,
  stock_quantity,
  is_parent,
  parent_product_id,
  ${PRODUCT_KEY_SPECS_RELATION_SELECT}
`;

const PRODUCT_SEMANTIC_INVENTORY_SELECT = `
  ${PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT},
  product_categories!inner(categories!inner(slug))
`;

/**
 * Loads the bounded semantic-link inventory directly from the public data API.
 * The legacy name is retained for call-site compatibility, but this function
 * deliberately has no Cache Components directive: transient query failures
 * must not become large shared empty/stale entries, and callers own the
 * optional-content fallback.
 */
export async function getCachedProductSemanticInventory(
  merchantId: string,
  categorySlug: string
): Promise<ProductSemanticCandidate[]> {
  const supabase = getPublicSupabaseClient();
  const inventoryQuery = supabase
    .from('products')
    .select(PRODUCT_SEMANTIC_INVENTORY_SELECT)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .eq('product_categories.categories.slug', categorySlug)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(PRODUCT_SEMANTIC_INVENTORY_LIMIT)
    .abortSignal(AbortSignal.timeout(PRODUCT_SEMANTIC_INVENTORY_TIMEOUT_MS));

  // Disable PostgREST's automatic GET retry. The shared cached Supabase client
  // bounds each fetch with AbortSignal.timeout(), which rejects with a NATIVE
  // `TimeoutError` — NOT `AbortError`. postgrest-js 2.108.2 only suppresses
  // retries for AbortError/ABORT_ERR (PostgrestBuilder shouldRetry), so a
  // TimeoutError on this large (~0.5MB for big categories) read otherwise fans
  // out into 4 attempts with 1/2/4s backoff ≈ 34s PER compare render (the
  // overlay is uncached, so every request paid it). One bounded attempt, then
  // the caller degrades to no related links. Mirrors the merchant-lookup
  // `retry(false)` precedent; the `typeof` guard keeps test doubles awaitable.
  const boundedQuery =
    typeof inventoryQuery.retry === 'function'
      ? inventoryQuery.retry(false)
      : inventoryQuery;

  const { data, error } = await boundedQuery;

  if (error) {
    console.error('Error fetching product semantic inventory:', {
      merchantId,
      categorySlug,
      error,
    });
    throw error;
  }

  return ((data ?? []) as ProductSemanticInventoryRow[])
    .map((row) => toProductSemanticCandidate(row, categorySlug))
    .filter(
      (candidate): candidate is ProductSemanticCandidate => candidate !== null
    );
}

export function parseSemanticProductPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeProductKeySpecs(
  value: ProductSemanticInventoryRow['product_key_specs']
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' ? first : null;
  }

  return value && typeof value === 'object' ? value : null;
}

function getJoinedCategorySlug(
  row: ProductSemanticInventoryRow
): string | null {
  const firstCategoryJoin = row.product_categories?.[0];
  const categories = firstCategoryJoin?.categories;
  const category = Array.isArray(categories) ? categories[0] : categories;
  return category?.slug?.trim() || null;
}

function toProductSemanticCandidate(
  row: ProductSemanticInventoryRow,
  fallbackCategorySlug: string
): ProductSemanticCandidate | null {
  const slug = row.slug?.trim();
  const name = row.name?.trim();
  const price = parseSemanticProductPrice(row.price);

  if (!slug || !name || price === null) {
    return null;
  }

  return {
    slug,
    name,
    price,
    brand: row.brand,
    condition: row.condition,
    stock: row.stock_quantity ?? row.stock,
    category_slug: getJoinedCategorySlug(row) ?? fallbackCategorySlug,
    product_key_specs: normalizeProductKeySpecs(row.product_key_specs),
  };
}

import {
  getRefinedSearchArgs,
  REFINED_SEARCH_MAX_OFFSET,
  readRefinedSearchRows,
  type SearchRefinements,
} from '@baci/shared/lib';
import { withSupabaseRetry } from '@/lib/api';
import { normalizeProductConditionFilterValue } from '@/lib/product-filter-options';
import { supabase } from '@/lib/supabase';
import { PRODUCT_SELECT } from './product-select';
import { transformProduct } from './product-transform';
import type { ProductsPage } from './product-utils.types';

async function fetchSingleRefinedProductsPage(
  merchantId: string,
  query: string,
  criteria: SearchRefinements,
  limit: number,
  offset: number
): Promise<ProductsPage> {
  const { data, error } = await withSupabaseRetry(
    async () =>
      await supabase.rpc(
        criteria.processor
          ? 'search_storefront_products_processor_refined'
          : 'search_storefront_products_refined',
        getRefinedSearchArgs(merchantId, query, criteria, limit, offset)
      )
  );
  if (error) throw new Error('Search results unavailable');
  const matches = readRefinedSearchRows(data);
  if (!matches.length) return { products: [], total: 0, nextOffset: null };
  const { data: raw, error: readError } = await withSupabaseRetry(
    async () =>
      await supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .in(
          'id',
          matches.map((row) => row.productId)
        )
  );
  if (readError) throw new Error('Search results unavailable');
  // The search RPC resolves the matching option and price. Cards navigate
  // to product details for selection, so variant hydration must not delay them.
  const rows = new Map(
    ((raw ?? []) as Record<string, unknown>[]).map((row) => [row.id, row])
  );
  // A matched row can vanish between the RPC snapshot and this read
  // (deactivated, unpublished, or RLS-filtered mid-request). Skip it and
  // render the surviving matches, mirroring web: failing the whole page
  // over one stale id is worse than a self-healing off-by-one total.
  const products = matches.flatMap((match) => {
    const row = rows.get(match.productId);
    if (!row) return [];
    // Unparseable rows are logged inside transformProduct; skip them like
    // missing rows so one malformed product cannot fail the whole page.
    const product = transformProduct(row);
    if (!product) return [];
    return [
      {
        ...product,
        price: match.price ?? product.price,
        condition:
          normalizeProductConditionFilterValue(match.condition) ??
          product.condition,
        searchMatch: match,
      },
    ];
  });
  // Total minus rows that vanished mid-read: the RPC snapshot total
  // overcounts the visible page by exactly the skipped rows.
  const total = matches[0].total - (matches.length - products.length);
  // Continuation guards on the unadjusted RPC total, never the visible
  // count: skipped rows stay ranked, so an adjusted guard would strand
  // valid rows past a skipped id on every refetch.
  return {
    products,
    total,
    nextOffset:
      offset + limit < matches[0].total &&
      offset + limit <= REFINED_SEARCH_MAX_OFFSET
        ? offset + limit
        : null,
  };
}

/**
 * Cap sequential skip-ahead fetches: each empty page costs an RPC plus a
 * products re-read, so unbounded skipping fans out on poisoned pages. The
 * capped page keeps its next offset, so list pagination still advances.
 */
const MAX_REFINED_PAGE_SKIPS = 3;

/** Advance past empty hydrated pages so list-owned pagination can mount. */
export async function fetchRefinedProductsPage(
  merchantId: string,
  query: string,
  criteria: SearchRefinements,
  limit: number,
  offset: number
): Promise<ProductsPage> {
  let currentOffset = offset;
  let skipped = 0;
  let skips = 0;
  for (;;) {
    const page = await fetchSingleRefinedProductsPage(
      merchantId,
      query,
      criteria,
      limit,
      currentOffset
    );
    if (
      page.products.length ||
      page.nextOffset === null ||
      skips >= MAX_REFINED_PAGE_SKIPS
    ) {
      return { ...page, total: Math.max(0, page.total - skipped) };
    }
    skipped += page.nextOffset - currentOffset;
    currentOffset = page.nextOffset;
    skips += 1;
  }
}

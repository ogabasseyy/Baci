import {
  getRefinedSearchArgs,
  readRefinedSearchRows,
  type SearchRefinements,
} from '@baci/shared/lib';
import { withSupabaseRetry } from '@/lib/api';
import { normalizeProductConditionFilterValue } from '@/lib/product-filter-options';
import { supabase } from '@/lib/supabase';
import { PRODUCT_SELECT } from './product-select';
import { transformProduct } from './product-transform';
import type { ProductsPage } from './product-utils.types';

export async function fetchRefinedProductsPage(
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
    const product = transformProduct(row);
    if (!product) throw new Error('Search results unavailable');
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
  return {
    products,
    total,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}

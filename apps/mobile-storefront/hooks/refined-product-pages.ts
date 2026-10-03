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
  const products = matches.map((match) => {
    const row = rows.get(match.productId);
    if (!row) throw new Error('Search results changed; try again');
    const product = transformProduct(row);
    if (!product) throw new Error('Search results unavailable');
    return {
      ...product,
      price: match.price ?? product.price,
      condition:
        normalizeProductConditionFilterValue(match.condition) ??
        product.condition,
      searchMatch: match,
    };
  });
  const total = matches[0].total;
  return {
    products,
    total,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}

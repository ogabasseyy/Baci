import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpSearchProductRow } from './search-products-query-helpers';
import { hydrateSearchProductAvailability } from './search-product-availability';

type BrowseFacet = 'brand' | 'category';

/** List public facet values from products that are not confirmed sold out. */
export async function loadMcpBrowseFacetValues({
  supabase,
  merchantId,
  facet,
  category,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  facet: BrowseFacet;
  category?: string;
}): Promise<string[]> {
  let query = supabase
    .from('products')
    .select('id, category, brand, manage_stock, stock_quantity, has_variants, has_condition_offers')
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .or('manage_stock.is.false,manage_stock.is.null,stock_quantity.gt.0,has_variants.is.true,has_condition_offers.is.true');
  if (category) query = query.ilike('category', `%${category}%`);

  const { data, error } = await query;
  if (error) {
    console.error('Failed to load public catalog facets:', error);
    return [];
  }
  const products = (data ?? []) as McpSearchProductRow[];
  const optionProducts = products.filter(
    (product) => product.manage_stock === true &&
      (product.has_variants === true || product.has_condition_offers === true)
  );
  const checkedOptions = await hydrateSearchProductAvailability(optionProducts, supabase);
  const soldOutIds = new Set(
    checkedOptions
      .filter(({ stockSummary }) => stockSummary.inStock === false)
      .map(({ product }) => product.id)
  );
  return [...new Set(products
    .filter((product) => !soldOutIds.has(product.id))
    .map((product) => product[facet])
    .filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

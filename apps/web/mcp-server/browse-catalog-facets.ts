import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpSearchProductRow } from './search-products-query-helpers';
import { getMcpProductStockSummary } from './product-stock-summary';

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
  const variantIds = optionProducts.filter((product) => product.has_variants).map((product) => product.id);
  const offerIds = optionProducts.filter((product) => product.has_condition_offers).map((product) => product.id);
  const [variantResult, offerResult] = await Promise.all([
    variantIds.length > 0
      ? supabase.rpc('get_storefront_product_variants', { p_product_ids: variantIds })
      : Promise.resolve({ data: [], error: null }),
    offerIds.length > 0
      ? supabase.from('product_offers')
          .select('product_id, stock_quantity')
          .eq('merchant_id', merchantId)
          .eq('status', 'active')
          .in('product_id', offerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (variantResult.error) console.error('Failed to load public variant facet stock:', variantResult.error);
  if (offerResult.error) console.error('Failed to load public offer facet stock:', offerResult.error);

  const variantStock = new Map<string, Array<{ stock_quantity: number | null }>>();
  const offerStock = new Map<string, Array<{ stock_quantity: number | null }>>();
  for (const row of variantResult.data ?? []) {
    variantStock.set(row.product_id, [...(variantStock.get(row.product_id) ?? []), row]);
  }
  for (const row of offerResult.data ?? []) {
    offerStock.set(row.product_id, [...(offerStock.get(row.product_id) ?? []), row]);
  }
  const soldOutIds = new Set(optionProducts.filter((product) =>
    getMcpProductStockSummary(
      product,
      product.has_variants && !variantResult.error ? variantStock.get(product.id) ?? [] : undefined,
      product.has_condition_offers && !offerResult.error ? offerStock.get(product.id) ?? [] : undefined
    ).inStock === false
  ).map((product) => product.id));
  return [...new Set(products
    .filter((product) => !soldOutIds.has(product.id))
    .map((product) => product[facet])
    .filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

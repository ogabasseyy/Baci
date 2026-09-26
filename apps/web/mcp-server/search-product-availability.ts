import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpSearchProductRow } from './search-products-query-helpers';
import { getMcpProductStockSummary } from './product-stock-summary';

interface ProductVariant {
  attributes: Record<string, unknown> | null;
  product_id: string;
  stock_quantity?: number | null;
}

export async function hydrateSearchProductAvailability(
  products: McpSearchProductRow[],
  supabase: SupabaseClient,
  merchantId: string
) {
  const productIds = products.filter((product) => product.has_variants).map((product) => product.id);
  const variantsMap = new Map<string, ProductVariant[]>();
  let variantLookupSucceeded = productIds.length === 0;

  if (productIds.length > 0) {
    const { data: variants, error } = await supabase.rpc(
      'get_storefront_product_variants',
      { p_product_ids: productIds }
    );
    if (error) {
      console.error('Failed to fetch product variants for search:', error);
    } else {
      variantLookupSucceeded = true;
      for (const variant of (variants ?? []) as ProductVariant[]) {
        variantsMap.set(variant.product_id, [
          ...(variantsMap.get(variant.product_id) ?? []),
          variant,
        ]);
      }
    }
  }

  const offersMap = new Map<string, Array<{ stock_quantity: number | null }>>();
  const offerIds = products.filter((product) => product.has_condition_offers).map((product) => product.id);
  if (offerIds.length > 0) {
    const { data, error } = await supabase.from('product_offers')
      .select('product_id, stock_quantity')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('product_id', offerIds);
    if (error) {
      console.error('Failed to fetch product offers for search:', error);
    } else {
      for (const offer of data ?? []) {
        offersMap.set(offer.product_id, [...(offersMap.get(offer.product_id) ?? []), offer]);
      }
      for (const id of offerIds) offersMap.set(id, offersMap.get(id) ?? []);
    }
  }

  return products.map((product) => ({
    product,
    stockSummary: getMcpProductStockSummary(
      product,
      product.has_variants && variantLookupSucceeded ? variantsMap.get(product.id) ?? [] : undefined,
      product.has_condition_offers ? offersMap.get(product.id) : undefined
    ),
    availableVariants: (variantsMap.get(product.id) ?? []).filter((variant) =>
      product.manage_stock !== true || Number(variant.stock_quantity ?? 0) > 0
    ),
  }));
}

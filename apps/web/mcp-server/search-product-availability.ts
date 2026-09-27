import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import type { McpSearchProductRow } from './search-products-query-helpers';
import { getMcpProductStockSummary } from './product-stock-summary';

interface ProductVariant {
  attributes: Record<string, unknown> | null;
  condition?: string | null;
  price_override?: number | null;
  product_id: string;
  stock_quantity?: number | null;
}

interface ProductOffer {
  condition: string | null;
  price: number | null;
  stock_quantity: number | null;
}

export async function hydrateSearchProductAvailability(
  products: McpSearchProductRow[],
  supabase: SupabaseClient,
  merchantId: string,
  requestedCondition?: string
) {
  const condition = normalizeCanonicalProductCondition(requestedCondition);
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

  const offersMap = new Map<string, ProductOffer[]>();
  const offerIds = products.filter((product) => product.has_condition_offers).map((product) => product.id);
  if (offerIds.length > 0) {
    const { data, error } = await supabase.from('product_offers')
      .select('product_id, condition, price, stock_quantity')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('product_id', offerIds);
    if (error) {
      console.error('Failed to fetch product offers for search:', error);
    } else {
      for (const offer of data ?? []) {
        if (condition && normalizeCanonicalProductCondition(offer.condition) !== condition) continue;
        offersMap.set(offer.product_id, [...(offersMap.get(offer.product_id) ?? []), offer]);
      }
      for (const id of offerIds) offersMap.set(id, offersMap.get(id) ?? []);
    }
  }

  return products.map((product) => {
    const variants = (variantsMap.get(product.id) ?? []).filter((variant) => {
      if (!condition) return true;
      const variantCondition = normalizeCanonicalProductCondition(
        variant.condition ?? (typeof variant.attributes?.condition === 'string' ? variant.attributes.condition : null)
      ) || normalizeCanonicalProductCondition(product.condition);
      return variantCondition === condition;
    });
    const offers = offersMap.get(product.id) ?? [];
    const basePurchasable = !product.has_variants &&
      (!condition || normalizeCanonicalProductCondition(product.condition) === condition) &&
      (product.manage_stock !== true || Number(product.stock_quantity ?? 0) > 0);
    const prices = [
      ...variants.filter((variant) => product.manage_stock !== true || Number(variant.stock_quantity ?? 0) > 0)
        .map((variant) => variant.price_override ?? product.price),
      ...offers.filter((offer) => product.manage_stock !== true || Number(offer.stock_quantity ?? 0) > 0)
        .map((offer) => offer.price),
      ...(basePurchasable ? [product.price] : []),
    ].filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price >= 0);
    const optionPriceLookupFailed =
      (product.has_variants && !variantLookupSucceeded) ||
      (product.has_condition_offers && !offersMap.has(product.id));
    const displayPrice = prices.length > 0
      ? Math.min(...prices)
      : optionPriceLookupFailed && !basePurchasable ? null : product.price;
    return {
      product,
      displayPrice,
      displayCompareAtPrice: displayPrice === product.price ? product.compare_at_price : null,
      stockSummary: getMcpProductStockSummary(
        condition && product.has_condition_offers &&
          normalizeCanonicalProductCondition(product.condition) !== condition
          ? { ...product, stock_quantity: 0 }
          : product,
        product.has_variants && variantLookupSucceeded ? variants : undefined,
        product.has_condition_offers ? offersMap.get(product.id) : undefined
      ),
      availableVariants: variants.filter((variant) =>
        product.manage_stock !== true || Number(variant.stock_quantity ?? 0) > 0
      ),
    };
  });
}

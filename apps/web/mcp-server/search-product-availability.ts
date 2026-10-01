import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import type { McpSearchProductRow } from './search-products-query-helpers';
import { getMcpProductStockSummary } from './product-stock-summary';

interface ProductVariant {
  id?: string;
  attributes: Record<string, unknown> | null;
  condition?: string | null;
  price_override?: number | null;
  product_id: string;
  stock_quantity?: number | null;
}

interface ProductOffer {
  id?: string;
  condition: string | null;
  price: number | null;
  compare_at_price?: number | null;
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
  let offerLookupSucceeded = offerIds.length === 0;
  if (offerIds.length > 0) {
    const { data, error } = await supabase.from('product_offers')
      .select('id, product_id, condition, price, compare_at_price, stock_quantity')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('product_id', offerIds)
      // PDP parity: the storefront orders offers by raw condition and ID before
      // find() takes the first canonical match, so selection must dedupe the
      // same first row instead of an arbitrary Postgres order.
      .order('condition')
      .order('id');
    if (error) {
      console.error('Failed to fetch product offers for search:', error);
    } else {
      offerLookupSucceeded = true;
      for (const offer of data ?? []) {
        if (condition && normalizeCanonicalProductCondition(offer.condition) !== condition) continue;
        offersMap.set(offer.product_id, [...(offersMap.get(offer.product_id) ?? []), offer]);
      }
      for (const id of offerIds) offersMap.set(id, offersMap.get(id) ?? []);
    }
  }

  return products.map((product) => {
    const baseCondition = normalizeCanonicalProductCondition(product.condition) || 'new';
    const variants = (variantsMap.get(product.id) ?? []).filter((variant) => {
      if (!condition) return true;
      const variantCondition = normalizeCanonicalProductCondition(
        variant.condition
      ) || baseCondition;
      return variantCondition === condition;
    });
    const offers = offersMap.get(product.id) ?? [];
    // PDP parity: both PDPs resolve the first row per canonical condition
    // with no stock check, so the ordered first row survives hydration even
    // when out of stock. Selection claims the condition on that row and
    // drops it on stock, instead of advertising a later duplicate the PDP
    // would never resolve.
    const seenOfferConditions = new Set<string>();
    const availableOffers = offers.filter((offer) => {
      const canonical = normalizeCanonicalProductCondition(offer.condition);
      const firstOfCondition = canonical !== '' && !seenOfferConditions.has(canonical);
      if (canonical !== '') seenOfferConditions.add(canonical);
      return product.manage_stock !== true
        || Number(offer.stock_quantity ?? 0) > 0
        || firstOfCondition;
    });
    // A null base condition sells as new on the PDP, so availability must
    // default it before comparing instead of rejecting it as unrecognized.
    const basePurchasable = !product.has_variants &&
      (!condition || baseCondition === condition) &&
      (product.manage_stock !== true || Number(product.stock_quantity ?? 0) > 0);
    const pricedOptions = [
      ...variants.filter((variant) => product.manage_stock !== true || Number(variant.stock_quantity ?? 0) > 0)
        .map((variant) => ({
          price: variant.price_override ?? product.price,
          condition: normalizeCanonicalProductCondition(
            variant.condition
          ) || baseCondition,
        })),
      ...offers.filter((offer) => product.manage_stock !== true || Number(offer.stock_quantity ?? 0) > 0)
        .map((offer) => ({ price: offer.price,
          condition: normalizeCanonicalProductCondition(offer.condition) || baseCondition })),
      ...(basePurchasable ? [{ price: product.price, condition: baseCondition }] : []),
    ].filter((option): option is { price: number; condition: typeof baseCondition } =>
      typeof option.price === 'number' && Number.isFinite(option.price) && option.price >= 0);
    const cheapestOption = pricedOptions.reduce<(typeof pricedOptions)[number] | undefined>(
      (cheapest, option) => !cheapest || option.price < cheapest.price ? option : cheapest,
      undefined
    );
    const optionPriceLookupFailed =
      (product.has_variants && !variantLookupSucceeded) ||
      (product.has_condition_offers && !offersMap.has(product.id));
    const variantLookupStatus = !product.has_variants
      ? 'not_required' as const
      : variantLookupSucceeded ? 'available' as const : 'failed' as const;
    const offerLookupStatus = !product.has_condition_offers
      ? 'not_required' as const
      : offerLookupSucceeded ? 'available' as const : 'failed' as const;
    const displayPrice = cheapestOption
      ? cheapestOption.price
      : optionPriceLookupFailed && !basePurchasable ? null : product.price;
    return {
      product,
      displayPrice,
      displayCondition: cheapestOption?.condition ?? baseCondition,
      displayCompareAtPrice: displayPrice === product.price ? product.compare_at_price : null,
      stockSummary: getMcpProductStockSummary(
        condition && product.has_condition_offers &&
          normalizeCanonicalProductCondition(product.condition) !== condition
          ? { ...product, stock_quantity: 0 }
          : product,
        product.has_variants && variantLookupSucceeded ? variants : undefined,
        product.has_condition_offers ? offersMap.get(product.id) : undefined
      ),
      availableOffers,
      optionsLookupFailed: optionPriceLookupFailed,
      variantLookupFailed: variantLookupStatus === 'failed',
      offerLookupFailed: offerLookupStatus === 'failed',
      variantLookupStatus,
      offerLookupStatus,
      basePurchasable,
      availableVariants: variants.filter((variant) =>
        product.manage_stock !== true || Number(variant.stock_quantity ?? 0) > 0
      ),
      // Unfiltered by condition: purchasability gates and the condition-axis
      // check mirror the PDP, which reasons over all variants.
      allVariants: variantsMap.get(product.id) ?? [],
      variantAttributeValues: (variantsMap.get(product.id) ?? []).flatMap((variant) =>
        Object.values(variant.attributes ?? {}).filter((value): value is string | number =>
          typeof value === 'string' || typeof value === 'number')),
    };
  });
}

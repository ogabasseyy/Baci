import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import type { McpSearchProductRow } from './search-products-query-helpers';
import { getMcpProductStockSummary } from './product-stock-summary';
import { SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY } from '../src/lib/hydrate-public-products';
import {
  getPublicSerializedVariantSummariesByProductId,
  type PublicSerializedVariantSummary,
} from '../src/lib/public-serialized-variant-summary';

interface ProductVariant {
  id?: string;
  attributes: Record<string, unknown> | null;
  condition?: string | null;
  created_at?: string | null;
  price_override?: number | null;
  product_id: string;
  stock_quantity?: number | null;
}

// Storefront snapshot windows (pdp_core_slug_case_insensitive): the PDP
// snapshot retains 16 offers by (condition, id) and 128 variants by
// (default, price, created, id) with a full-RPC fallback for selections
// outside. Search mirrors the windows; variant truncation is disclosed
// because the fallback can reach options search hides, while offers past
// 16 are invisible to the PDP itself.
const STOREFRONT_SNAPSHOT_OFFER_WINDOW = 16;
const STOREFRONT_SNAPSHOT_VARIANT_WINDOW = 128;
// PostgREST clamps responses at 1,000 rows, so the option RPCs page by
// product: 7 products carry at most 903 variant rows (129 each) and 62
// carry at most 992 offer rows (16 each), keeping every response complete.
const MCP_OPTION_VARIANT_PRODUCTS_PER_CALL = 7;
const MCP_OPTION_OFFER_PRODUCTS_PER_CALL = 62;

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
  // Simple serialized products resolve through the same projection as the
  // PDP: the helper returns summaries only for serialized policies (variant
  // products are projected inside the variants RPC instead, keeping this
  // lookup to one anchor row per simple product). A lookup failure keeps
  // stored stock rather than zeroing purchasability.
  const serializedSummaries = new Map<string, PublicSerializedVariantSummary>();
  const simpleProductIds = products
    .filter((product) => product.has_variants !== true)
    .map((product) => product.id);
  if (simpleProductIds.length > 0) {
    try {
      const summaries = await getPublicSerializedVariantSummariesByProductId(
        supabase,
        merchantId,
        simpleProductIds
      );
      for (const summary of summaries) {
        if (!summary.variantId) serializedSummaries.set(summary.productId, summary);
      }
    } catch {
      // Fall through with stored stock; options stay available.
    }
  }
  const effectiveProducts = products.map((product) => {
    const summary = serializedSummaries.get(product.id);
    if (!summary || product.has_variants === true) return product;
    // Mirrors hydrate-public-products.ts product-level resolution exactly.
    const resolvedUnits =
      summary.inventoryTrackingPolicy === 'serialized_then_unlimited' &&
      summary.publicAvailableUnits === 0
        ? SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY
        : summary.publicAvailableUnits;
    return {
      ...product,
      stock_quantity: resolvedUnits,
      manage_stock:
        summary.inventoryTrackingPolicy === 'serialized_strict'
          ? true
          : summary.inventoryTrackingPolicy === 'serialized_then_unlimited' &&
              product.manage_stock !== false
            ? false
            : product.manage_stock,
    };
  });
  const productIds = products.filter((product) => product.has_variants).map((product) => product.id);
  const variantsMap = new Map<string, ProductVariant[]>();
  let variantLookupSucceeded = productIds.length === 0;

  if (productIds.length > 0) {
    variantLookupSucceeded = true;
    for (
      let offset = 0;
      offset < productIds.length;
      offset += MCP_OPTION_VARIANT_PRODUCTS_PER_CALL
    ) {
      const batch = productIds.slice(
        offset,
        offset + MCP_OPTION_VARIANT_PRODUCTS_PER_CALL
      );
      const { data: variants, error } = await supabase.rpc(
        'get_mcp_search_product_variants',
        { p_product_ids: batch, p_merchant_id: merchantId }
      );
      if (error) {
        console.error('Failed to fetch product variants for search:', error);
        variantLookupSucceeded = false;
      } else {
        for (const variant of (variants ?? []) as ProductVariant[]) {
          variantsMap.set(variant.product_id, [
            ...(variantsMap.get(variant.product_id) ?? []),
            variant,
          ]);
        }
      }
    }
  }

  const offersMap = new Map<string, ProductOffer[]>();
  const offerIds = products.filter((product) => product.has_condition_offers).map((product) => product.id);
  let offerLookupSucceeded = offerIds.length === 0;
  if (offerIds.length > 0) {
    offerLookupSucceeded = true;
    for (
      let offset = 0;
      offset < offerIds.length;
      offset += MCP_OPTION_OFFER_PRODUCTS_PER_CALL
    ) {
      const batch = offerIds.slice(
        offset,
        offset + MCP_OPTION_OFFER_PRODUCTS_PER_CALL
      );
      const { data, error } = await supabase.rpc('get_mcp_search_product_offers', {
        p_product_ids: batch,
        p_merchant_id: merchantId,
      });
      if (error) {
        console.error('Failed to fetch product offers for search:', error);
        offerLookupSucceeded = false;
      } else {
        // Group the full ordered set: the 16-window slices first (the snapshot
        // has no condition filter), then the requested condition applies, so a
        // condition whose first row falls outside the window stays unresolvable
        // exactly like on the PDP.
        for (const offer of data ?? []) {
          offersMap.set(offer.product_id, [...(offersMap.get(offer.product_id) ?? []), offer]);
        }
        for (const id of batch) offersMap.set(id, offersMap.get(id) ?? []);
      }
    }
  }

  return effectiveProducts.map((product) => {
    const baseCondition = normalizeCanonicalProductCondition(product.condition) || 'new';
    // Window before filtering, mirroring the snapshot: cheapest 128 by
    // (price, created, id). The search row lacks default_variant_id, so the
    // snapshot's default-first nuance cannot apply; price order retains the
    // options selection actually needs.
    const fullVariants = variantsMap.get(product.id) ?? [];
    const windowedVariants = [...fullVariants].sort((left, right) =>
      (left.price_override ?? product.price ?? Number.POSITIVE_INFINITY) -
        (right.price_override ?? product.price ?? Number.POSITIVE_INFINITY) ||
      String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')) ||
      String(left.id ?? '').localeCompare(String(right.id ?? ''))
    ).slice(0, STOREFRONT_SNAPSHOT_VARIANT_WINDOW);
    const variantWindowTruncated = fullVariants.length > windowedVariants.length;
    const variants = windowedVariants.filter((variant) => {
      if (!condition) return true;
      const variantCondition = normalizeCanonicalProductCondition(
        variant.condition
      ) || baseCondition;
      return variantCondition === condition;
    });
    const offers = (offersMap.get(product.id) ?? [])
      .slice(0, STOREFRONT_SNAPSHOT_OFFER_WINDOW)
      .filter((offer) => !condition ||
        normalizeCanonicalProductCondition(offer.condition) === condition);
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
        product.has_condition_offers ? offers : undefined
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
      // Unfiltered by condition but windowed like the snapshot: gates and the
      // condition-axis check see the same 128 the PDP reasons over.
      allVariants: windowedVariants,
      variantAttributeValues: windowedVariants.flatMap((variant) =>
        Object.values(variant.attributes ?? {}).filter((value): value is string | number =>
          typeof value === 'string' || typeof value === 'number')),
      variantWindowTruncated,
    };
  });
}

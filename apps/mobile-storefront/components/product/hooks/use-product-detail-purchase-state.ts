import { useEffectivePrice } from '@/hooks/use-effective-price';
import { findMatchingConditionOffer } from '@/lib/product-condition-offers';
import { normalizeRouteCondition } from '@/lib/product-route/normalize-route-condition';
import { useTrackProductRouteViewed } from '@/services/tiktok-product-route-tracking';
import type { ProductCondition } from '@/types/product';
import type { useProductDetailRouteData } from './use-product-detail-route-data';

type RouteData = ReturnType<typeof useProductDetailRouteData>;

export function useProductDetailPurchaseState(
  routeData: RouteData,
  quantityInCart: number,
  negotiatedPrice: number | null
) {
  const { price: effectivePrice, comparePrice: effectiveComparePrice } =
    useEffectivePrice(
      routeData.product ?? null,
      routeData.currentVariantDisplaySelection,
      routeData.effectiveSelectedCondition,
      negotiatedPrice,
      routeData.routeOfferId,
      routeData.suppressConditionOfferMatch
    );
  const { price: calculatedPrice } = useEffectivePrice(
    routeData.product ?? null,
    routeData.currentVariantDisplaySelection,
    routeData.effectiveSelectedCondition,
    null,
    routeData.routeOfferId,
    routeData.suppressConditionOfferMatch
  );
  useTrackProductRouteViewed(routeData.product, effectivePrice);

  const selectedConditionOffer = !routeData.product?.has_variants
    ? findMatchingConditionOffer(
        routeData.product?.offers,
        routeData.offerConditionKey,
        routeData.routeOfferId,
        routeData.suppressConditionOfferMatch
      )
    : null;
  const resolvedVariantPurchaseSelection =
    routeData.currentVariantSelection ??
    routeData.currentVariantDisplaySelection;
  const selectedVariant = resolvedVariantPurchaseSelection?.variant;
  const selectedVariantCanPurchase =
    routeData.product?.has_variants === true
      ? resolvedVariantPurchaseSelection
        ? routeData.product.manage_stock === false
          ? true
          : selectedVariant?.effective_policy === 'serialized_then_unlimited'
            ? true
            : selectedVariant?.effective_policy === 'serialized_strict'
              ? (typeof selectedVariant.available_units === 'number'
                  ? selectedVariant.available_units
                  : 0) > quantityInCart
              : typeof selectedVariant?.stock_quantity === 'number'
                ? selectedVariant.stock_quantity > quantityInCart
                : selectedVariant?.in_stock !== false
        : false
      : false;
  const canPurchase =
    routeData.product?.has_variants === true
      ? Boolean(resolvedVariantPurchaseSelection) && selectedVariantCanPurchase
      : routeData.product
        ? routeData.product.manage_stock === false ||
          (typeof selectedConditionOffer?.stock_quantity === 'number'
            ? selectedConditionOffer.stock_quantity > quantityInCart
            : routeData.product.base_effective_policy ===
                'serialized_then_unlimited'
              ? true
              : routeData.product.base_effective_policy === 'serialized_strict'
                ? (typeof routeData.product.base_available_units === 'number'
                    ? routeData.product.base_available_units
                    : 0) > quantityInCart
                : typeof routeData.product.stock_quantity === 'number'
                  ? routeData.product.stock_quantity > quantityInCart
                  : routeData.product.in_stock === true)
        : false;

  const conditionOffersForDisplay = getConditionOffersForDisplay(routeData);
  return {
    calculatedPrice,
    canPurchase,
    conditionOffersForDisplay,
    effectiveComparePrice,
    effectivePrice,
    resolvedVariantPurchaseSelection,
  };
}

function getConditionOffersForDisplay(routeData: RouteData) {
  if (!routeData.product) return [];
  if (!routeData.usesVariantConditions) return routeData.product.offers ?? [];

  const grouped = new Map<
    ProductCondition,
    { price: number; stock_quantity: number }
  >();
  for (const variant of routeData.product.variants ?? []) {
    const condition = normalizeRouteCondition(variant.condition);
    if (!condition) continue;

    const price =
      variant.price_override ?? variant.price ?? routeData.product.price;
    const stockQuantity = variant.stock_quantity ?? 0;
    const existing = grouped.get(condition);
    if (!existing || price < existing.price) {
      grouped.set(condition, {
        price,
        stock_quantity: (existing?.stock_quantity ?? 0) + stockQuantity,
      });
      continue;
    }
    existing.stock_quantity += stockQuantity;
  }

  return Array.from(grouped.entries()).map(([condition, summary]) => ({
    id: `variant-condition-${condition}`,
    condition,
    price: summary.price,
    stock_quantity: summary.stock_quantity,
  }));
}

import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { useState } from 'react';
import type { AddToCartOptions } from '@/hooks/cart/cart-types';
import type { Product as CartProduct } from '@/lib/products';
import { getEffectiveStock } from '@/lib/product-stock';
import { resolveSerializedOfferStock } from '@/lib/serialized-offer-stock';
import type { ResolvedCriticalVariantSelection } from './critical-commerce-selection';
import {
  buildVariantCartProduct,
  compactVariantOptions,
} from './critical-commerce-selection';

export type CriticalRouteOfferLike = Pick<
  NonNullable<CartProduct['offers']>[number],
  'id' | 'condition' | 'price' | 'stock_quantity'
>;

/**
 * Resolves the pinned exact route offer for the critical buy box.
 * Mirrors the full PDP offer state: a resolved purchasable variant
 * selection prices the line (offer off), and the pinned offer must
 * match the selected condition so an explicit later pick wins over
 * the URL id. An unset condition keeps the pin — the route seeds the
 * offer's own condition.
 */
export function resolveCriticalActiveOffer({
  offers,
  initialOfferId,
  dismissed,
  hasPurchasableVariantSelection,
  selectedCondition,
}: {
  offers: readonly CriticalRouteOfferLike[] | null | undefined;
  initialOfferId: string | null | undefined;
  dismissed: boolean;
  hasPurchasableVariantSelection: boolean;
  selectedCondition: string | null | undefined;
}): CriticalRouteOfferLike | null {
  const routeOffer =
    !dismissed && initialOfferId
      ? (offers?.find((offer) => String(offer.id) === initialOfferId) ?? null)
      : null;
  if (!routeOffer || hasPurchasableVariantSelection) return null;
  if (
    selectedCondition != null &&
    normalizeCanonicalProductCondition(selectedCondition) !==
      normalizeCanonicalProductCondition(routeOffer.condition)
  ) {
    return null;
  }
  return routeOffer;
}

/**
 * Prices a critical cart product from the pinned route offer, using
 * the same serialized offer-stock rule as the full PDP: a strict
 * pool caps the finite advertised allocation by the retained base
 * units, then-unlimited keeps the scalar, and other policies fall
 * back to the scalar. Offer selections enforce their finite
 * allocation even on unmanaged parents. The stock base is the
 * pre-variant selection product: the priced base may already carry
 * variant-derived stock.
 */
export function applyCriticalRouteOfferToCartProduct(
  baseProduct: CartProduct,
  offer: CriticalRouteOfferLike,
  stockBase: Pick<
    CartProduct,
    'inventory_tracking_policy' | 'stock' | 'stock_quantity'
  >
): CartProduct {
  return {
    ...baseProduct,
    manage_stock: true,
    price: offer.price,
    condition: offer.condition,
    stock:
      resolveSerializedOfferStock(offer, {
        inventory_tracking_policy: stockBase.inventory_tracking_policy,
        stock: getEffectiveStock(stockBase),
      }) ?? offer.stock_quantity,
  };
}

/**
 * Critical route-offer state: the pinned offer, the offer-priced cart
 * product, and the missing gate. Exact-offer deep links pin the buy
 * box until the shopper picks a condition; a missing offer blocks
 * purchase until then (mirrors the full PDP's useRouteOfferMissing).
 */
export function useCriticalRouteOfferState({
  routeOfferMissing,
  initialOfferId,
  selectionCartProduct,
  selectedVariantSelection,
  hasPurchasableVariantSelection,
  selectedCondition,
}: {
  routeOfferMissing: boolean;
  initialOfferId: string | null | undefined;
  selectionCartProduct: CartProduct;
  selectedVariantSelection: ResolvedCriticalVariantSelection | null;
  hasPurchasableVariantSelection: boolean;
  selectedCondition: string | null | undefined;
}) {
  const [offerDismissed, setOfferDismissed] = useState(false);
  // Client-side navigation can swap the route offer under a mounted
  // provider: reset the dismissal when the route input changes so a
  // fresh deep link is never ignored because of the previous URL's
  // explicit pick (render-time reset, React-endorsed for derived
  // state). Consecutive missing-offer URLs share one key — an
  // accepted residual: the second dead link reuses the dismissal.
  const routeKey = `${initialOfferId ?? ''}|${routeOfferMissing}`;
  const [lastRouteKey, setLastRouteKey] = useState(routeKey);
  if (lastRouteKey !== routeKey) {
    setLastRouteKey(routeKey);
    setOfferDismissed(false);
  }
  const activeRouteOffer = resolveCriticalActiveOffer({
    offers: selectionCartProduct.offers,
    initialOfferId,
    dismissed: offerDismissed,
    hasPurchasableVariantSelection,
    selectedCondition,
  });
  const baseProductForCart = buildVariantCartProduct(
    selectionCartProduct,
    selectedVariantSelection
  );
  return {
    activeRouteOffer,
    dismissRouteOffer: () => setOfferDismissed(true),
    productForCart: activeRouteOffer
      ? applyCriticalRouteOfferToCartProduct(
          baseProductForCart,
          activeRouteOffer,
          selectionCartProduct
        )
      : baseProductForCart,
    routeOfferMissingActive: routeOfferMissing && !offerDismissed,
  };
}

/**
 * Cart-add options for the critical buy box: the resolved variant
 * selection when present, plus the exact route offer id so two offers
 * that canonicalize to the same condition keep separate cart lines.
 */
export function buildCriticalCartAddOptions({
  purchasableSelection,
  productForCart,
  activeRouteOffer,
}: {
  purchasableSelection: ResolvedCriticalVariantSelection | null;
  productForCart: CartProduct;
  activeRouteOffer: CriticalRouteOfferLike | null;
}): AddToCartOptions | undefined {
  const variantOptions = purchasableSelection
    ? compactVariantOptions({
        color:
          purchasableSelection.color ??
          purchasableSelection.attributes.color,
        condition:
          purchasableSelection.condition ?? productForCart.condition,
        storage:
          purchasableSelection.storage ??
          purchasableSelection.attributes.storage,
        variantAttributes: purchasableSelection.attributes,
        variantId: purchasableSelection.variant.id,
      })
    : productForCart.condition
      ? { condition: productForCart.condition }
      : undefined;
  return activeRouteOffer != null
    ? { ...variantOptions, offerId: String(activeRouteOffer.id) }
    : variantOptions;
}

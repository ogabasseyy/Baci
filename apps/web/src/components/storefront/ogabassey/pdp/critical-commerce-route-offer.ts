import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { useState } from 'react';
import type { AddToCartOptions } from '@/hooks/cart/cart-types';
import type { Product as CartProduct } from '@/lib/products';
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
 * Prices a critical cart product from the pinned route offer. Offer
 * selections enforce their finite allocation even on unmanaged
 * parents (mirrors the full PDP offer state).
 */
export function applyCriticalRouteOfferToCartProduct(
  baseProduct: CartProduct,
  offer: CriticalRouteOfferLike
): CartProduct {
  return {
    ...baseProduct,
    manage_stock: true,
    price: offer.price,
    condition: offer.condition,
    stock: offer.stock_quantity,
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
      ? applyCriticalRouteOfferToCartProduct(baseProductForCart, activeRouteOffer)
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

'use client';

import { useCart } from '@/hooks/cart';
import { findMergingCartLineIndex } from '@/hooks/cart/find-merging-cart-line';
import type { Product as CartProduct } from '@/lib/products';
import {
  buildCriticalCartAddOptions,
  type CriticalRouteOfferLike,
} from './critical-commerce-route-offer';
import type { ResolvedCriticalVariantSelection } from './critical-commerce-selection';

interface CriticalCommerceCartActionsInput {
  activeRouteOffer: CriticalRouteOfferLike | null;
  canAddToCart: boolean;
  effectivePurchasableVariantSelection: ResolvedCriticalVariantSelection | null;
  productForCart: CartProduct;
  quantity: number;
}

/**
 * Cart submission for the critical buy box. The add options are shared
 * between the pre-add existence check and the add itself so the
 * reported `quantityInCart` always agrees with the line the add merges
 * into.
 */
export function useCriticalCommerceCartActions({
  activeRouteOffer,
  canAddToCart,
  effectivePurchasableVariantSelection,
  productForCart,
  quantity,
}: CriticalCommerceCartActionsInput) {
  // `cart` defaults for test doubles that stub only the cart actions.
  const { addToCart, cart = [], setIsCartOpen } = useCart();
  const cartAddOptions = buildCriticalCartAddOptions({
    purchasableSelection: effectivePurchasableVariantSelection,
    productForCart,
    activeRouteOffer,
  });
  const mergingCartLineIndex = findMergingCartLineIndex(
    cart,
    productForCart,
    cartAddOptions
  );
  const quantityInCart =
    mergingCartLineIndex >= 0
      ? (cart[mergingCartLineIndex]?.quantity ?? 0)
      : 0;

  function handleAddToCart() {
    if (!canAddToCart) {
      return;
    }

    addToCart(productForCart, quantity, cartAddOptions);
    setIsCartOpen(true);
  }

  return { handleAddToCart, quantityInCart };
}

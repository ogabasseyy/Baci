'use client';

import { useCart } from '@/hooks/cart';
import { generateCartItemId } from '@/hooks/cart/cart-storage';
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
  maxQuantity?: number | null;
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
  maxQuantity = null,
  productForCart,
  quantity,
}: CriticalCommerceCartActionsInput) {
  // `cart` defaults for test doubles that stub only the cart actions.
  const { addToCart, cart = [], removeFromCart, updateQuantity } = useCart();
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
  const mergingCartLine =
    mergingCartLineIndex >= 0 ? cart[mergingCartLineIndex] : undefined;
  const quantityInCart = mergingCartLine?.quantity ?? 0;
  const minimumQuantity = Math.max(
    1,
    mergingCartLine?.minimum_order_quantity ??
      productForCart.minimum_order_quantity ??
      1
  );
  const isAtMinCartQuantity =
    quantityInCart > 0 && quantityInCart <= minimumQuantity;
  const targetCartItemId =
    mergingCartLine?.cartItemId ||
    mergingCartLine?.id ||
    generateCartItemId(productForCart.id, cartAddOptions);
  const targetVariantId = mergingCartLine?.cartItemId
    ? undefined
    : mergingCartLine?.variantId;

  function handleAddToCart() {
    if (!canAddToCart) {
      return;
    }

    addToCart(productForCart, quantity, cartAddOptions);
  }

  function handleIncrementCartQuantity() {
    if (
      !canAddToCart ||
      quantityInCart <= 0 ||
      (maxQuantity !== null && quantityInCart >= maxQuantity)
    ) {
      return;
    }

    updateQuantity?.(targetCartItemId, quantityInCart + 1, targetVariantId);
  }

  function handleDecrementCartQuantity() {
    if (quantityInCart <= 0) {
      return;
    }

    if (quantityInCart <= minimumQuantity) {
      removeFromCart?.(targetCartItemId, targetVariantId);
      return;
    }

    updateQuantity?.(targetCartItemId, quantityInCart - 1, targetVariantId);
  }

  return {
    handleAddToCart,
    handleDecrementCartQuantity,
    handleIncrementCartQuantity,
    isAtMinCartQuantity,
    quantityInCart,
  };
}

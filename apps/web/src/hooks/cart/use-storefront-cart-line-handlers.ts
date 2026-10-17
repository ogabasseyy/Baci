'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Product } from '@/lib/products';
import { DEFAULT_ASSURANCE_RATE, generateCartItemId } from './cart-storage';
import type { AddToCartOptions, CartItem } from './cart-types';
import { findMergingCartLineIndex } from './find-merging-cart-line';
import { gateAddToCart } from './gate-add-to-cart';
import type { useStorefrontCartDelegation } from './use-storefront-cart-delegation';

type DelegatedActions = ReturnType<
  typeof useStorefrontCartDelegation
>['delegatedActions'];

/** Legacy/delegated line mutations and merchant binding for the provider. */
export function useStorefrontCartLineHandlers({
  cartWideNegotiationActiveRef,
  delegated,
  delegatedActions,
  enableSmartCartPro,
  setCart,
  setCartWideNegotiationActive,
  setLastAddedProduct,
  setShowUpsell,
  upsellTimerRef,
}: {
  cartWideNegotiationActiveRef: RefObject<boolean>;
  delegated: boolean;
  delegatedActions: DelegatedActions;
  enableSmartCartPro: boolean;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setCartWideNegotiationActive: (active: boolean) => void;
  setLastAddedProduct: Dispatch<SetStateAction<Product | null>>;
  setShowUpsell: Dispatch<SetStateAction<boolean>>;
  upsellTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const noteAddedProduct = (added: Product) => {
    if (enableSmartCartPro) {
      setLastAddedProduct(added);
      upsellTimerRef.current = setTimeout(() => {
        setShowUpsell(true);
      }, 500);
    }
  };

  const addToCart = (
    product: Product,
    quantity = 1,
    options?: AddToCartOptions
  ) => {
    const gated = gateAddToCart(product, options);
    if (!gated) return;
    const productForCart = gated.product;
    const normalizedOptions = gated.options;

    if (delegated) {
      const accepted = delegatedActions.addToCart(
        productForCart,
        quantity,
        normalizedOptions
      );
      if (accepted) noteAddedProduct(productForCart);
      return;
    }

    const wasGroupActive = cartWideNegotiationActiveRef.current;
    setCart((previousCart) => {
      const cartItemId = generateCartItemId(
        productForCart.id,
        normalizedOptions
      );
      const existingIndex = findMergingCartLineIndex(
        previousCart,
        product,
        normalizedOptions
      );

      let result: CartItem[];
      if (existingIndex >= 0) {
        const nextCart = [...previousCart];
        const existingItem = nextCart[existingIndex];
        nextCart[existingIndex] = {
          ...existingItem,
          quantity: existingItem.quantity + quantity,
          cartItemId: existingItem.cartItemId || cartItemId,
        };
        result = nextCart;
      } else {
        result = [
          ...previousCart,
          {
            ...productForCart,
            cartItemId,
            quantity,
            variantId: normalizedOptions?.variantId,
            variantAttributes: normalizedOptions?.variantAttributes,
            selectedColor: normalizedOptions?.color,
            selectedColorValue: normalizedOptions?.colorValue,
            secondaryColor: normalizedOptions?.secondaryColor,
            secondaryColorValue: normalizedOptions?.secondaryColorValue,
            selectedStorage: normalizedOptions?.storage,
            condition: normalizedOptions?.condition as
              | 'new'
              | 'used'
              | 'open_box'
              | 'refurbished'
              | undefined,
            quizAwardId: normalizedOptions?.quizAwardId,
            quizVoucherToken: normalizedOptions?.quizVoucherToken,
            negotiationStatus: 'none',
            hasAssurance: false,
            assuranceRate: DEFAULT_ASSURANCE_RATE,
          },
        ];
      }

      // Adding/merging a line changes the cart composition, so an active
      // cart-wide deal no longer represents the agreed total — reset it.
      if (wasGroupActive) {
        return result.map((item) =>
          item.negotiatedPrice === undefined &&
          item.negotiationStatus === undefined
            ? item
            : {
                ...item,
                negotiatedPrice: undefined,
                negotiationStatus: undefined,
              }
        );
      }
      return result;
    });

    if (wasGroupActive) {
      setCartWideNegotiationActive(false);
    }

    noteAddedProduct(productForCart);
  };

  const removeFromCart = (
    cartItemIdOrProductId: string,
    variantId?: string
  ) => {
    if (delegated) {
      delegatedActions.removeFromCart(cartItemIdOrProductId, variantId);
      return;
    }
    const wasGroupActive = cartWideNegotiationActiveRef.current;
    setCart((previousCart) => {
      const filtered = previousCart.filter((item) => {
        if (variantId) {
          return !(
            item.id === cartItemIdOrProductId && item.variantId === variantId
          );
        }

        if (item.cartItemId && item.cartItemId === cartItemIdOrProductId) {
          return false;
        }

        return !(item.id === cartItemIdOrProductId && !item.variantId);
      });

      // A cart-wide (group) negotiation distributes one negotiated total across
      // all lines; removing a line breaks that total, so reset the group deal
      // and revert remaining lines to catalog price.
      if (wasGroupActive) {
        return filtered.map((item) => ({
          ...item,
          negotiatedPrice: undefined,
          negotiationStatus: undefined,
        }));
      }

      return filtered;
    });
    if (wasGroupActive) {
      setCartWideNegotiationActive(false);
    }
  };

  const updateQuantity = (
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ) => {
    if (delegated) {
      delegatedActions.updateQuantity(
        cartItemIdOrProductId,
        quantity,
        variantId
      );
      return;
    }
    const wasGroupActive = cartWideNegotiationActiveRef.current;
    setCart((previousCart) => {
      const targetIndex = previousCart.findIndex((item) => {
        if (variantId) {
          return (
            item.id === cartItemIdOrProductId && item.variantId === variantId
          );
        }

        return (
          item.cartItemId === cartItemIdOrProductId ||
          (item.id === cartItemIdOrProductId && !item.variantId)
        );
      });

      if (targetIndex === -1) return previousCart;
      if (quantity <= 0) {
        const filtered = previousCart.filter(
          (_, index) => index !== targetIndex
        );
        if (wasGroupActive) {
          return filtered.map((item) => ({
            ...item,
            negotiatedPrice: undefined,
            negotiationStatus: undefined,
          }));
        }
        return filtered;
      }

      const nextCart = [...previousCart];
      const item = nextCart[targetIndex];
      const minimumOrderQuantity = item.minimum_order_quantity || 1;
      nextCart[targetIndex] = {
        ...item,
        quantity:
          quantity < minimumOrderQuantity ? minimumOrderQuantity : quantity,
      };
      // A quantity change alters the cart total, so an active cart-wide
      // negotiation no longer represents the agreed total — clear the group
      // deal on every line (not only when the line is removed).
      if (wasGroupActive) {
        return nextCart.map((line) => ({
          ...line,
          negotiatedPrice: undefined,
          negotiationStatus: undefined,
        }));
      }
      return nextCart;
    });
    if (wasGroupActive) {
      setCartWideNegotiationActive(false);
    }
  };

  return {
    addToCart,
    removeFromCart,
    updateQuantity,
  };
}

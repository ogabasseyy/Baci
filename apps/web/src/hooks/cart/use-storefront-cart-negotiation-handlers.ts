'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { CartItem } from './cart-types';
import type { useStorefrontCartDelegation } from './use-storefront-cart-delegation';

type DelegatedActions = ReturnType<
  typeof useStorefrontCartDelegation
>['delegatedActions'];

/** Smart-cart negotiation and assurance handlers for the provider. */
export function useStorefrontCartNegotiationHandlers({
  cart,
  cartWideNegotiationActiveRef,
  delegated,
  delegatedActions,
  enableSmartCartPro,
  setCart,
  setCartWideNegotiationActive,
  setShowUpsell,
}: {
  cart: CartItem[];
  cartWideNegotiationActiveRef: RefObject<boolean>;
  delegated: boolean;
  delegatedActions: DelegatedActions;
  enableSmartCartPro: boolean;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setCartWideNegotiationActive: (active: boolean) => void;
  setShowUpsell: Dispatch<SetStateAction<boolean>>;
}) {
  const applyNegotiatedPrice = (cartItemId: string, newPrice: number) => {
    if (!enableSmartCartPro) return;
    if (delegated) {
      delegatedActions.applyNegotiatedPrice(cartItemId, newPrice);
      return;
    }
    const wasGroupActive = cartWideNegotiationActiveRef.current;
    setCart((previousCart) => {
      // If a cart-wide deal was active, clear the proportional group prices from
      // the other lines first so only this line keeps a negotiation.
      const base = wasGroupActive
        ? previousCart.map((item) =>
            item.negotiatedPrice === undefined &&
            item.negotiationStatus === undefined
              ? item
              : {
                  ...item,
                  negotiatedPrice: undefined,
                  negotiationStatus: undefined,
                }
          )
        : previousCart;
      return base.map((item) =>
        item.cartItemId === cartItemId
          ? {
              ...item,
              negotiatedPrice: newPrice,
              negotiationStatus: 'accepted',
            }
          : item
      );
    });
    // Individual-line negotiation — not a group deal.
    setCartWideNegotiationActive(false);
  };

  const clearNegotiatedPrice = (cartItemId: string) => {
    if (!enableSmartCartPro) return;
    if (delegated) {
      delegatedActions.clearNegotiatedPrice(cartItemId);
      return;
    }
    setCart((previousCart) =>
      previousCart.map((item) =>
        item.cartItemId === cartItemId
          ? {
              ...item,
              negotiatedPrice: undefined,
              negotiationStatus: undefined,
            }
          : item
      )
    );
    setCartWideNegotiationActive(false);
  };

  const applyCartWideNegotiation = (newTotal: number) => {
    if (!enableSmartCartPro) return;

    if (delegated) {
      delegatedActions.applyCartWideNegotiation(newTotal);
      return;
    }

    const currentTotal = cart.reduce((sum, item) => {
      const price = item.negotiatedPrice ?? item.price;
      return sum + price * item.quantity;
    }, 0);
    if (currentTotal <= 0) return;

    const ratio = newTotal / currentTotal;
    setCart((previousCart) =>
      previousCart.map((item) => ({
        ...item,
        negotiatedPrice: (item.negotiatedPrice ?? item.price) * ratio,
        negotiationStatus: 'accepted',
      }))
    );
    setCartWideNegotiationActive(true);
  };

  const toggleAssurance = (cartItemId: string) => {
    if (!enableSmartCartPro) return;
    if (delegated) {
      delegatedActions.toggleAssurance(cartItemId);
      return;
    }
    setCart((previousCart) =>
      previousCart.map((item) =>
        item.cartItemId === cartItemId
          ? { ...item, hasAssurance: !item.hasAssurance }
          : item
      )
    );
  };

  const dismissUpsell = () => {
    setShowUpsell(false);
  };
  return {
    applyCartWideNegotiation,
    applyNegotiatedPrice,
    clearNegotiatedPrice,
    dismissUpsell,
    toggleAssurance,
  };
}

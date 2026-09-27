'use client';

import { useState } from 'react';
import { isProductNegotiable } from '@baci/shared/lib';
import { type CartItem } from '@/hooks/cart';
import { runCartTotalNegotiation } from '../lib/cart-total-negotiation';

// Negotiation modal state, managed here so every cart surface shares one flow.
export interface CartSidebarNegotiationState {
  isOpen: boolean;
  type: 'single' | 'total';
  item?: CartItem; // Present if type is 'single'
  currentPrice: number;
  name: string;
}

export function useCartSidebarNegotiation({
  cart,
  cartTotal,
  hasNonNegotiableCartItem,
  applyNegotiatedPrice,
  applyCartWideNegotiation,
  clearNegotiatedPrice,
}: {
  cart: CartItem[];
  cartTotal: number;
  hasNonNegotiableCartItem: boolean;
  applyNegotiatedPrice?: (cartItemId: string, newPrice: number) => void;
  applyCartWideNegotiation?: (newTotal: number) => void;
  clearNegotiatedPrice?: (cartItemId: string) => void;
}) {
  const [negotiationState, setNegotiationState] =
    useState<CartSidebarNegotiationState | null>(null);

  const handleNegotiationSuccess = (finalPrice: number) => {
    if (!negotiationState) return;

    if (negotiationState.type === 'single' && negotiationState.item) {
      // finalPrice is the negotiated TOTAL for the line item (Unit Price * Quantity)
      const quantity = negotiationState.item.quantity;
      const newUnitPrice = finalPrice / quantity;
      applyNegotiatedPrice?.(negotiationState.item.cartItemId, newUnitPrice);
    } else if (negotiationState.type === 'total') {
      applyCartWideNegotiation?.(finalPrice);
    }
  };

  const openItemNegotiation = (item: CartItem) => {
    if (!isProductNegotiable({ brand: item.brand, name: item.name })) {
      return;
    }

    const currentUnitPrice = item.negotiatedPrice || item.price || 0;
    const currentTotal = currentUnitPrice * item.quantity;

    setNegotiationState({
      isOpen: true,
      type: 'single',
      item: item,
      currentPrice: currentTotal,
      name: item.quantity > 1 ? `${item.name} (x${item.quantity})` : item.name,
    });
  };

  const openTotalNegotiation = () => {
    if (hasNonNegotiableCartItem) {
      return;
    }

    runCartTotalNegotiation({
      cart,
      fallbackTotal: cartTotal,
      clearNegotiatedPrice,
      confirmReset: () =>
        window.confirm(
          'Negotiating your whole cart will clear the prices you negotiated on individual items. Reset them and continue?'
        ),
      openBulk: (currentPrice) =>
        setNegotiationState({
          isOpen: true,
          type: 'total',
          currentPrice,
          name: 'Entire Cart',
        }),
    });
  };

  const closeNegotiation = () => {
    setNegotiationState(null);
  };

  return {
    negotiationState,
    handleNegotiationSuccess,
    openItemNegotiation,
    openTotalNegotiation,
    closeNegotiation,
  };
}

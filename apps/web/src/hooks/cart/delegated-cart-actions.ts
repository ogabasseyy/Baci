'use client';

import { SHARED_CART_MAX_QUANTITY_PER_LINE } from '@baci/shared/cart';
import type { RefObject } from 'react';
import type { Product } from '@/lib/products';
import type { AddToCartOptions, SharedCartDisplayItem } from './cart-types';
import { planDelegatedAddQuantity } from './delegated-add-preflight';
import {
  delegatedLineTarget,
  planGroupDealVoid,
} from './storefront-cart-delegation';
import type { useSharedCart } from './use-shared-cart';

/** Routes canonical edits and invalidates proportional group deals in queue order. */
export function createDelegatedCartActions(
  shared: Pick<
    ReturnType<typeof useSharedCart>,
    | 'cart'
    | 'repriceLine'
    | 'removeFromCart'
    | 'updateQuantity'
    | 'addToCart'
    | 'clearCart'
    | 'toggleAssurance'
  >,
  cartWideNegotiationActiveRef: RefObject<boolean>,
  setCartWideNegotiationActive: (active: boolean) => void
) {
  // Group-deal voiding for delegated edits (see planGroupDealVoid):
  // reprices every negotiated server line except the edit's own target.
  const voidDelegatedGroupDeal = (
    exceptCartItemId?: string,
    quantityOverrides?: ReadonlyMap<string, number>
  ) => {
    if (!cartWideNegotiationActiveRef.current) return;
    for (const line of planGroupDealVoid(
      shared.cart,
      exceptCartItemId,
      quantityOverrides
    )) {
      shared.repriceLine(line);
    }
    setCartWideNegotiationActive(false);
  };

  const firstDelegatedTarget = (
    cartItemIdOrProductId: string,
    variantId?: string
  ): SharedCartDisplayItem | null =>
    delegatedLineTarget(shared.cart, cartItemIdOrProductId, variantId);

  const removeFromCart = (
    cartItemIdOrProductId: string,
    variantId?: string
  ) => {
    // The removed line is excluded from the void: its clear would race
    // the removal for the same server line ID.
    const target = firstDelegatedTarget(cartItemIdOrProductId, variantId);
    voidDelegatedGroupDeal(target?.cartItemId);
    shared.removeFromCart(cartItemIdOrProductId, variantId);
    return;
  };
  const updateQuantity = (
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ) => {
    const target = firstDelegatedTarget(cartItemIdOrProductId, variantId);
    if (quantity <= 0) {
      voidDelegatedGroupDeal(target?.cartItemId);
      shared.removeFromCart(cartItemIdOrProductId, variantId);
      return;
    }
    if (!target) {
      // Legacy quirk: an update that matches nothing still drops the
      // group flag while leaving negotiated prices in place.
      if (cartWideNegotiationActiveRef.current) {
        setCartWideNegotiationActive(false);
      }
      return;
    }
    // The edit queues ahead of the void clears so its server line ID is
    // still live when it sends; the clears then retire it deliberately,
    // re-adding at the same clamped quantity as the edit.
    shared.updateQuantity(cartItemIdOrProductId, quantity, variantId);
    const minimum = target.minimum_order_quantity ?? 1;
    const clamped = Math.min(
      SHARED_CART_MAX_QUANTITY_PER_LINE,
      Math.max(minimum, Math.floor(quantity))
    );
    voidDelegatedGroupDeal(undefined, new Map([[target.cartItemId, clamped]]));
    return;
  };
  const applyNegotiatedPrice = (cartItemId: string, newPrice: number) => {
    const target = shared.cart.find((line) => line.cartItemId === cartItemId);
    const wasGroupActive = cartWideNegotiationActiveRef.current;
    // Individual-line negotiation — not a group deal.
    setCartWideNegotiationActive(false);
    if (!target) return;
    // A previously active group deal clears from the other lines first so
    // only this line keeps a negotiation, mirroring the legacy reset.
    if (wasGroupActive) {
      for (const line of shared.cart) {
        if (line.cartItemId === cartItemId) continue;
        if (
          line.negotiatedPrice === undefined &&
          line.negotiationStatus === undefined
        ) {
          continue;
        }
        shared.repriceLine(line);
      }
    }
    shared.repriceLine(target, newPrice);
    return;
  };
  const clearNegotiatedPrice = (cartItemId: string) => {
    const target = shared.cart.find((line) => line.cartItemId === cartItemId);
    setCartWideNegotiationActive(false);
    if (target) shared.repriceLine(target);
    return;
  };
  const applyCartWideNegotiation = (newTotal: number) => {
    // The server has no group-deal operation, so the provider distributes
    // the agreed total proportionally as per-line server reprices — the
    // same ratio math as the legacy path, confirmed line by line.
    const currentTotal = shared.cart.reduce((sum, item) => {
      const price = item.negotiatedPrice ?? item.price;
      return sum + price * item.quantity;
    }, 0);
    if (currentTotal <= 0) return;
    const ratio = newTotal / currentTotal;
    for (const line of shared.cart) {
      shared.repriceLine(line, (line.negotiatedPrice ?? line.price) * ratio);
    }
    setCartWideNegotiationActive(true);
    return;
  };
  return {
    removeFromCart,
    updateQuantity,
    applyNegotiatedPrice,
    clearNegotiatedPrice,
    applyCartWideNegotiation,
    addToCart(product: Product, quantity: number, options?: AddToCartOptions) {
      // A capped, out-of-stock, or variant-blocked add is a no-op in
      // the shared hook; it must not void the group deal on its way
      // out, and the provider must not announce it as added.
      const sendQuantity = planDelegatedAddQuantity(
        shared.cart,
        product,
        quantity,
        options,
        cartWideNegotiationActiveRef.current
      );
      if (sendQuantity <= 0) return false;
      voidDelegatedGroupDeal();
      shared.addToCart(product, sendQuantity, options);
      return true;
    },
    clearCart() {
      setCartWideNegotiationActive(false);
      shared.clearCart();
    },
    toggleAssurance: shared.toggleAssurance,
  };
}

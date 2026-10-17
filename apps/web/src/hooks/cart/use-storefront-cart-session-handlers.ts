'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { logger } from '@/lib/logger';
import {
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
  saveMerchantSlugToStorage,
} from './cart-storage';
import type { CartItem } from './cart-types';
import { getMerchantCartState } from './merchant-cart-storage';
import type { useStorefrontCartDelegation } from './use-storefront-cart-delegation';

type DelegatedActions = ReturnType<
  typeof useStorefrontCartDelegation
>['delegatedActions'];

/** Cart clearing and merchant-slug binding for the provider. */
export function useStorefrontCartSessionHandlers({
  bumpSessionGeneration,
  delegated,
  delegatedActions,
  initialMerchantSlug,
  merchantId,
  merchantSlug,
  merchantSlugRef,
  setCart,
  setCartWideNegotiationActive,
  setIsHydrated,
  setMerchantSlugState,
  sharedCartEnabled,
}: {
  bumpSessionGeneration: () => void;
  delegated: boolean;
  delegatedActions: DelegatedActions;
  initialMerchantSlug: string | null;
  merchantId: string | null;
  merchantSlug: string | null;
  merchantSlugRef: RefObject<string | null>;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setCartWideNegotiationActive: (active: boolean) => void;
  setIsHydrated: Dispatch<SetStateAction<boolean>>;
  setMerchantSlugState: Dispatch<SetStateAction<string | null>>;
  sharedCartEnabled: boolean;
}) {
  const clearCart = () => {
    if (delegated) {
      // Server clear retains the cart identity, so the merchant binding
      // stays: only the group flag resets alongside the lines.
      delegatedActions.clearCart();
      logger.info({ message: 'Cart cleared' });
      return;
    }
    // Clear persisted state against the active merchant slug first — the
    // persistence effect runs after `merchantSlug` is nulled, so it would
    // otherwise write the cleared cart against the default key and leave the
    // merchant-scoped cart/group-negotiation state to rehydrate on refresh.
    const slugToClear = merchantSlug;
    saveCartToStorage([], slugToClear);
    saveCartWideNegotiationToStorage(false, slugToClear);
    setCart([]);
    merchantSlugRef.current = null;
    setMerchantSlugState(null);
    saveMerchantSlugToStorage(null);
    setCartWideNegotiationActive(false);
    logger.info({ message: 'Cart cleared' });
  };

  const setMerchantSlug = (slug: string) => {
    if (merchantSlugRef.current === slug) {
      saveMerchantSlugToStorage(slug);
      return;
    }

    merchantSlugRef.current = slug;
    setMerchantSlugState(slug);
    saveMerchantSlugToStorage(slug);
    // Every slug change fences the previous shared session; the hook
    // re-adopts under the new generation when the slug stays enrolled.
    bumpSessionGeneration();
    const nextDelegated =
      sharedCartEnabled &&
      merchantId !== null &&
      initialMerchantSlug !== null &&
      slug === initialMerchantSlug;
    if (nextDelegated) {
      setCartWideNegotiationActive(false);
      return;
    }
    const merchantCartState = getMerchantCartState(slug);
    setCart(merchantCartState.cart);
    setCartWideNegotiationActive(merchantCartState.cartWideNegotiationActive);
    setIsHydrated(true);
  };
  return { clearCart, setMerchantSlug };
}

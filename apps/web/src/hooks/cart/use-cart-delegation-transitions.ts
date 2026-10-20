'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { getMerchantSlugFromStorage } from './cart-storage';
import type { CartItem } from './cart-types';
import { getMerchantCartState } from './merchant-cart-storage';

interface Input {
  delegated: boolean;
  merchantSlug: string | null;
  initialMerchantSlug: string | null;
  merchantId: string | null;
  sharedCartEnabled: boolean;
  isHydrated: boolean;
  shared: { isHydrated: boolean };
  bumpSessionGeneration: () => void;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setMerchantSlugState: Dispatch<SetStateAction<string | null>>;
  setCartWideNegotiationActiveState: Dispatch<SetStateAction<boolean>>;
  setIsHydrated: Dispatch<SetStateAction<boolean>>;
}
/** Fence delegated rollback and merchant transitions before a stale frame commits. */
export function useCartDelegationTransitions({
  delegated,
  merchantSlug,
  initialMerchantSlug,
  merchantId,
  sharedCartEnabled,
  isHydrated,
  shared,
  bumpSessionGeneration,
  setCart,
  setMerchantSlugState,
  setCartWideNegotiationActiveState,
  setIsHydrated,
}: Input): void {
  const [wasDelegated, setWasDelegated] = useState(delegated);
  if (wasDelegated !== delegated) {
    setWasDelegated(delegated);
    if (wasDelegated && !delegated && merchantSlug === initialMerchantSlug) {
      // Rollback must never expose the parked pre-adoption cache. Fence all
      // outstanding canonical work and start a safe empty legacy cart.
      bumpSessionGeneration();
      setCart([]);
      setCartWideNegotiationActiveState(false);
      setIsHydrated(true);
    }
  }

  // Re-sync the slug + cart when the merchant slug prop changes (after the
  // initial hydration). Adjusting during render avoids the stale frame a
  // prop-sync effect would introduce, and only runs on an actual prop change.
  // See react.dev "Adjusting some state when a prop changes". The provider mount-time
  // load (storage is unavailable during SSR) still happens in its hydration effect
  // so the server-rendered empty cart stays until `isHydrated` flips.
  const [prevInitialMerchantSlug, setPrevInitialMerchantSlug] =
    useState(initialMerchantSlug);
  // In delegated mode the legacy hydration flag never flips (its effect is
  // fenced), so the shared hook's hydration drives the prop-change branch.
  // It must not reuse `delegated`: during the transition render the slug
  // state still holds the old merchant, which would deadlock the branch.
  const propChangeReady = isHydrated || shared.isHydrated;
  if (propChangeReady && initialMerchantSlug !== prevInitialMerchantSlug) {
    setPrevInitialMerchantSlug(initialMerchantSlug);
    const slugToUse = initialMerchantSlug || getMerchantSlugFromStorage();
    const nextDelegated =
      sharedCartEnabled &&
      merchantId !== null &&
      initialMerchantSlug !== null &&
      slugToUse === initialMerchantSlug;
    // State setters only: ref writes are not rolled back when React abandons
    // a render, so the refs sync from committed state in the effects below.
    // A ref holding an uncommitted slug would make setMerchantSlug
    // early-return and skip loading that merchant's cart.
    setMerchantSlugState(slugToUse);
    // A new served merchant always fences the previous shared session, even
    // when both sides delegate.
    bumpSessionGeneration();
    if (nextDelegated) {
      // The shared hook re-adopts under the new generation; the legacy cart
      // state stays parked and the group deal never crosses merchants.
      setCartWideNegotiationActiveState(false);
    } else {
      const merchantCartState = getMerchantCartState(slugToUse);
      // Prune quiz-prize voucher lines whose signed token has already expired
      // (7-day window). An expired voucher line is forced to ₦0 and re-fails
      // every checkout until removed, so it must never survive rehydration.
      setCart(merchantCartState.cart);
      // Re-read the group flag for the new merchant too, so it stays consistent
      // with the freshly loaded cart (otherwise the previous merchant's flag
      // leaks onto this cart).
      setCartWideNegotiationActiveState(
        merchantCartState.cartWideNegotiationActive
      );
      setIsHydrated(true);
    }
  }
}

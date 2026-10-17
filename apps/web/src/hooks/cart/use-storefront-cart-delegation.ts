'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { CartItem } from './cart-types';
import { createDelegatedCartActions } from './delegated-cart-actions';
import { useCartDelegationTransitions } from './use-cart-delegation-transitions';
import { useSharedCartDelegation } from './use-shared-cart-delegation';

interface Input {
  sharedCartEnabled: boolean;
  sharedCartRealtimeEnabled: boolean;
  merchantId: string | null;
  merchantSlug: string | null;
  initialMerchantSlug: string | null;
  isHydrated: boolean;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setMerchantSlugState: Dispatch<SetStateAction<string | null>>;
  setCartWideNegotiationActiveState: Dispatch<SetStateAction<boolean>>;
  setIsHydrated: Dispatch<SetStateAction<boolean>>;
  cartWideNegotiationActiveRef: RefObject<boolean>;
  setCartWideNegotiationActive: (active: boolean) => void;
}

/**
 * All shared-cart delegation orchestration for the storefront provider:
 * the delegation decision and delegated cart, the transition fencing,
 * and the delegated action set. The provider only branches on the
 * returned `delegated` flag and calls the returned actions.
 */
export function useStorefrontCartDelegation(input: Input) {
  const { bumpSessionGeneration, delegated, shared } = useSharedCartDelegation({
    sharedCartEnabled: input.sharedCartEnabled,
    sharedCartRealtimeEnabled: input.sharedCartRealtimeEnabled,
    merchantId: input.merchantId,
    merchantSlug: input.merchantSlug,
    initialMerchantSlug: input.initialMerchantSlug,
  });

  useCartDelegationTransitions({
    delegated,
    merchantSlug: input.merchantSlug,
    initialMerchantSlug: input.initialMerchantSlug,
    merchantId: input.merchantId,
    sharedCartEnabled: input.sharedCartEnabled,
    isHydrated: input.isHydrated,
    shared,
    bumpSessionGeneration,
    setCart: input.setCart,
    setMerchantSlugState: input.setMerchantSlugState,
    setCartWideNegotiationActiveState: input.setCartWideNegotiationActiveState,
    setIsHydrated: input.setIsHydrated,
  });

  const delegatedActions = createDelegatedCartActions(
    shared,
    input.cartWideNegotiationActiveRef,
    input.setCartWideNegotiationActive
  );

  return { bumpSessionGeneration, delegated, delegatedActions, shared };
}

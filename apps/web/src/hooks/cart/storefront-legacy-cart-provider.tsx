'use client';

import { useEffect, useRef, useState } from 'react';
import type { Product } from '@/lib/products';
import { CartContext } from './cart-context';
import {
  DEFAULT_ASSURANCE_RATE,
  DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS,
  getMerchantSlugFromStorage,
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
} from './cart-storage';
import type { CartContextType, CartItem } from './cart-types';
import { getMerchantCartState } from './merchant-cart-storage';
import type { StorefrontCartProviderProps } from './storefront-shared-cart-provider';
import { useDeferredValidationActivation } from './use-deferred-validation-activation';
import { useLegacyCartValidation } from './use-legacy-cart-validation';
import type { useStorefrontCartDelegation } from './use-storefront-cart-delegation';
import { useStorefrontCartLineHandlers } from './use-storefront-cart-line-handlers';
import { useStorefrontCartNegotiationHandlers } from './use-storefront-cart-negotiation-handlers';
import { useStorefrontCartSessionHandlers } from './use-storefront-cart-session-handlers';

type DelegatedActions = ReturnType<
  typeof useStorefrontCartDelegation
>['delegatedActions'];

const NOOP_DELEGATED_ACTIONS: DelegatedActions = {
  addToCart: () => false,
  applyCartWideNegotiation: () => undefined,
  applyNegotiatedPrice: () => undefined,
  clearCart: () => undefined,
  clearNegotiatedPrice: () => undefined,
  removeFromCart: () => undefined,
  toggleAssurance: () => undefined,
  updateQuantity: () => undefined,
};

function noopBumpSessionGeneration() {
  // No-op when shared-cart delegation is disabled.
}

export function StorefrontLegacyCartProvider({
  children,
  enableSmartCartPro = false,
  merchantSlug: initialMerchantSlug = null,
  deferValidationUntilIdle = false,
  validationActivationTimeoutMs = DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS,
  merchantId = null,
  deferHydration = false,
}: StorefrontCartProviderProps & { deferHydration?: boolean }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartWideNegotiationActive, setCartWideNegotiationActiveState] =
    useState(false);
  const cartWideNegotiationActiveRef = useRef(false);
  const setCartWideNegotiationActive = (active: boolean) => {
    cartWideNegotiationActiveRef.current = active;
    setCartWideNegotiationActiveState(active);
  };
  const [merchantSlug, setMerchantSlugState] = useState<string | null>(
    initialMerchantSlug
  );
  const merchantSlugRef = useRef<string | null>(initialMerchantSlug);
  const [isHydrated, setIsHydrated] = useState(false);
  const [idleValidationActivated, setIdleValidationActivated] = useState(false);
  const isValidationActivated =
    !deferValidationUntilIdle || idleValidationActivated;
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [lastAddedProduct, setLastAddedProduct] = useState<Product | null>(
    null
  );
  const [showUpsell, setShowUpsell] = useState(false);
  const upsellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prevInitialMerchantSlug, setPrevInitialMerchantSlug] =
    useState(initialMerchantSlug);
  if (
    !deferHydration &&
    isHydrated &&
    initialMerchantSlug !== prevInitialMerchantSlug
  ) {
    setPrevInitialMerchantSlug(initialMerchantSlug);
    const slugToUse = initialMerchantSlug || getMerchantSlugFromStorage();
    setMerchantSlugState(slugToUse);
    const merchantCartState = getMerchantCartState(slugToUse);
    setCart(merchantCartState.cart);
    setCartWideNegotiationActiveState(
      merchantCartState.cartWideNegotiationActive
    );
    setIsHydrated(true);
  }

  useEffect(() => {
    merchantSlugRef.current = merchantSlug;
  }, [merchantSlug]);

  useEffect(() => {
    cartWideNegotiationActiveRef.current = cartWideNegotiationActive;
  }, [cartWideNegotiationActive]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only hydration; initialMerchantSlug prop changes handled during render
  useEffect(() => {
    if (deferHydration) return;
    const slugToUse = initialMerchantSlug || getMerchantSlugFromStorage();
    const merchantCartState = getMerchantCartState(slugToUse);
    merchantSlugRef.current = slugToUse;
    setCart(merchantCartState.cart);
    setCartWideNegotiationActive(merchantCartState.cartWideNegotiationActive);
    setMerchantSlugState(slugToUse);
    setIsHydrated(true);
  }, [deferHydration]);

  useDeferredValidationActivation({
    deferValidationUntilIdle,
    idleValidationActivated,
    validationActivationTimeoutMs,
    onActivate: setIdleValidationActivated,
  });

  useLegacyCartValidation({
    cart,
    cartWideNegotiationActive,
    delegated: false,
    isHydrated,
    isValidationActivated,
    setCart,
    setCartWideNegotiationActiveState,
    cartWideNegotiationActiveRef,
  });

  useEffect(() => {
    if (deferHydration) return;
    if (isHydrated) {
      saveCartToStorage(cart, merchantSlug);
      saveCartWideNegotiationToStorage(cartWideNegotiationActive, merchantSlug);
    }
  }, [
    cart,
    cartWideNegotiationActive,
    deferHydration,
    isHydrated,
    merchantSlug,
  ]);

  useEffect(() => {
    return () => {
      if (upsellTimerRef.current) {
        clearTimeout(upsellTimerRef.current);
      }
    };
  }, []);

  const { clearCart, setMerchantSlug } = useStorefrontCartSessionHandlers({
    bumpSessionGeneration: noopBumpSessionGeneration,
    delegated: false,
    delegatedActions: NOOP_DELEGATED_ACTIONS,
    initialMerchantSlug,
    merchantId,
    merchantSlug,
    merchantSlugRef,
    setCart,
    setCartWideNegotiationActive,
    setIsHydrated,
    setMerchantSlugState,
    sharedCartEnabled: false,
  });
  const { addToCart, removeFromCart, updateQuantity } =
    useStorefrontCartLineHandlers({
      cartWideNegotiationActiveRef,
      delegated: false,
      delegatedActions: NOOP_DELEGATED_ACTIONS,
      enableSmartCartPro,
      setCart,
      setCartWideNegotiationActive,
      setLastAddedProduct,
      setShowUpsell,
      upsellTimerRef,
    });
  const {
    applyCartWideNegotiation,
    applyNegotiatedPrice,
    clearNegotiatedPrice,
    dismissUpsell,
    toggleAssurance,
  } = useStorefrontCartNegotiationHandlers({
    cart,
    cartWideNegotiationActiveRef,
    delegated: false,
    delegatedActions: NOOP_DELEGATED_ACTIONS,
    enableSmartCartPro,
    setCart,
    setCartWideNegotiationActive,
    setShowUpsell,
  });

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartTotal = cart.reduce((total, item) => {
    const itemPrice = item.negotiatedPrice ?? item.price;
    const itemTotal = itemPrice * item.quantity;
    const assuranceCost = item.hasAssurance
      ? itemTotal * (item.assuranceRate ?? DEFAULT_ASSURANCE_RATE)
      : 0;
    return total + itemTotal + assuranceCost;
  }, 0);

  const value: CartContextType = {
    cart,
    merchantSlug,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    setMerchantSlug,
    cartCount,
    cartTotal,
    totalItems: cartCount,
    subtotal: cartTotal,
    isCartOpen,
    setIsCartOpen,
    applyNegotiatedPrice: enableSmartCartPro ? applyNegotiatedPrice : undefined,
    applyCartWideNegotiation: enableSmartCartPro
      ? applyCartWideNegotiation
      : undefined,
    clearNegotiatedPrice: enableSmartCartPro ? clearNegotiatedPrice : undefined,
    cartWideNegotiationActive,
    toggleAssurance: enableSmartCartPro ? toggleAssurance : undefined,
    lastAddedProduct,
    showUpsell: enableSmartCartPro ? showUpsell : false,
    dismissUpsell,
    hasSmartCartPro: enableSmartCartPro,
    isHydrated,
    sharedCartEnabled: false,
    sharedCartAccountsEnabled: false,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

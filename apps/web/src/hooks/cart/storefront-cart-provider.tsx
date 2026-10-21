'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
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
import { useDeferredValidationActivation } from './use-deferred-validation-activation';
import { useLegacyCartValidation } from './use-legacy-cart-validation';
import { useStorefrontCartDelegation } from './use-storefront-cart-delegation';
import { useStorefrontCartLineHandlers } from './use-storefront-cart-line-handlers';
import { useStorefrontCartNegotiationHandlers } from './use-storefront-cart-negotiation-handlers';
import { useStorefrontCartSessionHandlers } from './use-storefront-cart-session-handlers';

interface StorefrontCartProviderProps {
  children: ReactNode;
  enableSmartCartPro?: boolean;
  merchantSlug?: string | null;
  deferValidationUntilIdle?: boolean;
  validationActivationTimeoutMs?: number;
  /**
   * Enrolled merchant identity for shared-cart delegation. The server frame
   * evaluates enrollment; the provider delegates only while the active slug
   * matches the enrolled merchant. Null/flag-missing means legacy local cart.
   */
  merchantId?: string | null;
  sharedCartEnabled?: boolean;
  sharedCartAccountsEnabled?: boolean;
  sharedCartRealtimeEnabled?: boolean;
}

export function StorefrontCartProvider({
  children,
  enableSmartCartPro = false,
  merchantSlug: initialMerchantSlug = null,
  deferValidationUntilIdle = false,
  validationActivationTimeoutMs = DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS,
  merchantId = null,
  sharedCartEnabled = false,
  sharedCartAccountsEnabled = false,
  sharedCartRealtimeEnabled = false,
}: StorefrontCartProviderProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  // True while a cart-wide (group) negotiation is applied. Removing a line
  // invalidates the proportional group total, so it is reset on removal.
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
  // Tracks idle/interaction-driven activation only. The non-deferred case is
  // derived below so the activation effect never sets state synchronously.
  const [idleValidationActivated, setIdleValidationActivated] = useState(false);
  const isValidationActivated =
    !deferValidationUntilIdle || idleValidationActivated;
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [lastAddedProduct, setLastAddedProduct] = useState<Product | null>(
    null
  );
  const [showUpsell, setShowUpsell] = useState(false);
  const upsellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { bumpSessionGeneration, delegated, delegatedActions, shared } =
    useStorefrontCartDelegation({
      sharedCartEnabled,
      sharedCartRealtimeEnabled,
      merchantId,
      merchantSlug,
      initialMerchantSlug,
      isHydrated,
      setCart,
      setMerchantSlugState,
      setCartWideNegotiationActiveState,
      setIsHydrated,
      cartWideNegotiationActiveRef,
      setCartWideNegotiationActive,
    });
  // Serialized add-probe ref: addToCart probes against this ref and
  // advances it synchronously on applied adds, so two adds in the same
  // tick observe each other. Synced from committed state below.
  const cartRef = useRef<CartItem[]>(cart);
  // Merchant context is the same source the line items use for the
  // shipping-insurance toggle, so the add-time default can never charge
  // a fee the toggle hides. Null outside a merchant provider (tests,
  // non-shell usages), where the slug-scoped default is preserved.
  const merchantContext = useMerchantSafe();

  // Keep the handler-facing refs aligned with committed state. Handlers read
  // the refs to avoid stale closures; syncing here (not during render) keeps
  // them consistent with what actually committed.
  useEffect(() => {
    merchantSlugRef.current = merchantSlug;
  }, [merchantSlug]);

  useEffect(() => {
    cartWideNegotiationActiveRef.current = cartWideNegotiationActive;
  }, [cartWideNegotiationActive]);

  // Serializes batched adds for outcome reporting: addToCart probes
  // against this ref and advances it synchronously on applied adds, so
  // two adds in the same tick observe each other (the render's `cart`
  // would show both the same stale snapshot). Updater-based writers
  // (remove, quantity edits, validation) converge here after commit;
  // value writers below sync it eagerly.
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // Hydrate cart + merchant slug from localStorage after mount (storage is
  // unavailable during SSR), gated by `isHydrated` so consumers keep rendering
  // the server cart until hydration completes; prop-driven slug changes are
  // handled by the render-time comparison above. The cart is locally mutable
  // AND localStorage-persisted, so cleanly eliminating this effect is a
  // useSyncExternalStore migration — tracked as a dedicated follow-up rather
  // than risked in a bulk cleanup. (react-doctor's set-state-in-effect is a
  // React Compiler diagnostic and cannot be inline-suppressed; the migration is
  // the real resolution.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only hydration; initialMerchantSlug prop changes handled during render
  useEffect(() => {
    // Delegated mounts seed from the same cache inside the shared hook; the
    // legacy cart state stays parked so there is exactly one writer.
    if (delegated) return;
    const slugToUse = initialMerchantSlug || getMerchantSlugFromStorage();
    const merchantCartState = getMerchantCartState(slugToUse);
    merchantSlugRef.current = slugToUse;
    setCart(merchantCartState.cart);
    setCartWideNegotiationActive(merchantCartState.cartWideNegotiationActive);
    setMerchantSlugState(slugToUse);
    setIsHydrated(true);
  }, []);

  useDeferredValidationActivation({
    deferValidationUntilIdle,
    idleValidationActivated,
    validationActivationTimeoutMs,
    onActivate: setIdleValidationActivated,
  });

  useLegacyCartValidation({
    cart,
    cartWideNegotiationActive,
    delegated,
    isHydrated,
    isValidationActivated,
    setCart,
    setCartWideNegotiationActiveState,
    cartWideNegotiationActiveRef,
  });

  useEffect(() => {
    // The shared hook persists its own display cache; a legacy write here
    // would overwrite it with the parked (stale) legacy cart.
    if (delegated) return;
    if (isHydrated) {
      saveCartToStorage(cart, merchantSlug);
      saveCartWideNegotiationToStorage(cartWideNegotiationActive, merchantSlug);
    }
  }, [cart, cartWideNegotiationActive, isHydrated, merchantSlug, delegated]);

  useEffect(() => {
    return () => {
      if (upsellTimerRef.current) {
        clearTimeout(upsellTimerRef.current);
      }
    };
  }, []);

  const { clearCart, setMerchantSlug } = useStorefrontCartSessionHandlers({
    bumpSessionGeneration,
    cartRef,
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
  });
  const { addToCart, removeFromCart, updateQuantity } =
    useStorefrontCartLineHandlers({
      cartRef,
      cartWideNegotiationActiveRef,
      delegated,
      delegatedActions,
      enableSmartCartPro,
      merchantContext,
      merchantSlugRef,
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
    delegated,
    delegatedActions,
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
    cart: delegated ? shared.cart : cart,
    merchantSlug,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    setMerchantSlug,
    cartCount: delegated ? shared.cartCount : cartCount,
    cartTotal: delegated ? shared.cartTotal : cartTotal,
    totalItems: delegated ? shared.cartCount : cartCount,
    subtotal: delegated ? shared.cartTotal : cartTotal,
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
    isHydrated: delegated ? shared.isHydrated : isHydrated,
    sharedCartEnabled: delegated,
    sharedCartAccountsEnabled: delegated && sharedCartAccountsEnabled,
    ...(delegated
      ? {
          syncStatus: shared.syncStatus,
          syncError: shared.syncError,
          retryPendingSync: shared.retryPendingSync,
          importConflicts: shared.importConflicts,
          importWarnings: shared.importWarnings,
          discardLegacyImport: shared.discardLegacyImport,
          resolveImportConflicts: shared.resolveImportConflicts,
          sharedCartRef:
            shared.cartId && shared.version !== null && !shared.isTerminal
              ? { cartId: shared.cartId, version: shared.version }
              : null,
          refreshSharedCart: shared.refreshSharedCart,
        }
      : {}),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import type { Product } from '@/lib/products';
import { CartContext } from './cart-context';
import {
  DEFAULT_ASSURANCE_RATE,
  DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS,
  generateCartItemId,
  getMerchantSlugFromStorage,
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
  saveMerchantSlugToStorage,
} from './cart-storage';
import type { AddToCartOptions, CartContextType, CartItem } from './cart-types';
import { findMergingCartLineIndex } from './find-merging-cart-line';
import { gateAddToCart } from './gate-add-to-cart';
import { getMerchantCartState } from './merchant-cart-storage';
import { useDeferredValidationActivation } from './use-deferred-validation-activation';
import { useLegacyCartValidation } from './use-legacy-cart-validation';
import { useStorefrontCartDelegation } from './use-storefront-cart-delegation';

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

  // Keep the handler-facing refs aligned with committed state. Handlers read
  // the refs to avoid stale closures; syncing here (not during render) keeps
  // them consistent with what actually committed.
  useEffect(() => {
    merchantSlugRef.current = merchantSlug;
  }, [merchantSlug]);

  useEffect(() => {
    cartWideNegotiationActiveRef.current = cartWideNegotiationActive;
  }, [cartWideNegotiationActive]);

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
            shared.cartId && shared.version !== null
              ? { cartId: shared.cartId, version: shared.version }
              : null,
          refreshSharedCart: shared.refreshSharedCart,
        }
      : {}),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

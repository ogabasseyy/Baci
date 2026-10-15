'use client';

import { resolveDefaultVariantSelection } from '@baci/shared/lib';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';
import { logger } from '@/lib/logger';
import type { Product } from '@/lib/products';
import { resolveSerializedVariantStock } from '@/lib/serialized-variant-stock';
import { CartContext } from './cart-context';
import { applyStorefrontCartLineAdd } from './cart-line-add';
import {
  capUpdatedSimpleLineQuantity,
  resolveSimpleLineAddCaps,
} from './cart-stock-caps';
import {
  DEFAULT_ASSURANCE_RATE,
  DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS,
  getMerchantSlugFromStorage,
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
  saveMerchantSlugToStorage,
} from './cart-storage';
import type {
  AddToCartOptions,
  AddToCartOutcome,
  CartContextType,
  CartItem,
} from './cart-types';
import { getMerchantCartState } from './merchant-cart-storage';
import {
  applyValidationResults,
  createCartHash,
  validateStorefrontCart,
} from './storefront-cart-validation';

interface StorefrontCartProviderProps {
  children: ReactNode;
  enableSmartCartPro?: boolean;
  merchantSlug?: string | null;
  deferValidationUntilIdle?: boolean;
  validationActivationTimeoutMs?: number;
}

/**
 * Quantity-edit line targeting, shared by the applied-ness probe and
 * the cart updater so the two can never diverge: an explicit variant
 * id pins the line, otherwise the V2 cart item id or a variant-less
 * product id matches.
 */
function findQuantityEditTargetIndex(
  cart: CartItem[],
  cartItemIdOrProductId: string,
  variantId?: string
): number {
  return cart.findIndex((item) => {
    if (variantId) {
      return item.id === cartItemIdOrProductId && item.variantId === variantId;
    }
    return (
      item.cartItemId === cartItemIdOrProductId ||
      (item.id === cartItemIdOrProductId && !item.variantId)
    );
  });
}

export function StorefrontCartProvider({
  children,
  enableSmartCartPro = false,
  merchantSlug: initialMerchantSlug = null,
  deferValidationUntilIdle = false,
  validationActivationTimeoutMs = DEFAULT_DEFERRED_VALIDATION_TIMEOUT_MS,
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
  const lastValidatedCartHashRef = useRef('');
  const cartRef = useRef<CartItem[]>(cart);
  // Merchant context is the same source the line items use for the
  // shipping-insurance toggle, so the add-time default can never charge
  // a fee the toggle hides. Null outside a merchant provider (tests,
  // non-shell usages), where the slug-scoped default is preserved.
  const merchantContext = useMerchantSafe();

  // Re-sync the slug + cart when the merchant slug prop changes (after the
  // initial hydration). Adjusting during render avoids the stale frame a
  // prop-sync effect would introduce, and only runs on an actual prop change.
  // See react.dev "Adjusting some state when a prop changes". The mount-time
  // load (storage is unavailable during SSR) still happens in the effect below
  // so the server-rendered empty cart stays until `isHydrated` flips.
  const [prevInitialMerchantSlug, setPrevInitialMerchantSlug] =
    useState(initialMerchantSlug);
  if (isHydrated && initialMerchantSlug !== prevInitialMerchantSlug) {
    setPrevInitialMerchantSlug(initialMerchantSlug);
    const slugToUse = initialMerchantSlug || getMerchantSlugFromStorage();
    const merchantCartState = getMerchantCartState(slugToUse);
    // State setters only: ref writes are not rolled back when React abandons
    // a render, so the refs sync from committed state in the effects below.
    // A ref holding an uncommitted slug would make setMerchantSlug
    // early-return and skip loading that merchant's cart.
    setMerchantSlugState(slugToUse);
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
  }

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
    const slugToUse = initialMerchantSlug || getMerchantSlugFromStorage();
    const merchantCartState = getMerchantCartState(slugToUse);
    merchantSlugRef.current = slugToUse;
    setCart(merchantCartState.cart);
    setCartWideNegotiationActive(merchantCartState.cartWideNegotiationActive);
    setMerchantSlugState(slugToUse);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!deferValidationUntilIdle || idleValidationActivated) {
      return;
    }

    let cancelled = false;
    let idleCallbackId: number | undefined;
    let loadListenerAttached = false;
    let cancelActivationGate: (() => void) | undefined;
    const activateValidation = () => {
      if (cancelled) {
        return;
      }
      // A speculatively prerendered PDP (Speculation Rules `prerender`) runs
      // this provider's JS in a hidden tab. Committing validation there would
      // POST /api/cart/validate and persist the result to the shared cart
      // storage for a page the shopper may never open — mutating their real
      // cart or clearing negotiations. Defer the commit until the page is
      // actually presented; a discarded prerender never activates, so it never
      // runs. Outside prerender this invokes the callback synchronously, so
      // behaviour is unchanged.
      cancelActivationGate?.();
      cancelActivationGate = runWhenPageActivated(() => {
        if (!cancelled) {
          setIdleValidationActivated(true);
        }
      });
    };

    const scheduleIdleActivation = () => {
      if (cancelled || idleCallbackId !== undefined) return;

      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(activateValidation, {
          timeout: validationActivationTimeoutMs || 1000,
        });
        return;
      }

      idleCallbackId = window.setTimeout(activateValidation, 0);
    };

    const handleWindowLoad = () => {
      window.removeEventListener('load', handleWindowLoad);
      loadListenerAttached = false;
      scheduleIdleActivation();
    };

    const timeoutId =
      validationActivationTimeoutMs > 0
        ? window.setTimeout(activateValidation, validationActivationTimeoutMs)
        : undefined;

    if (document.readyState === 'complete') {
      scheduleIdleActivation();
    } else {
      loadListenerAttached = true;
      window.addEventListener('load', handleWindowLoad, { once: true });
    }

    window.addEventListener('pointerdown', activateValidation, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', activateValidation, { once: true });
    window.addEventListener('scroll', activateValidation, {
      once: true,
      passive: true,
    });

    return () => {
      cancelled = true;
      cancelActivationGate?.();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);

      if (idleCallbackId !== undefined) {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleCallbackId);
        } else {
          window.clearTimeout(idleCallbackId);
        }
      }

      if (loadListenerAttached) {
        window.removeEventListener('load', handleWindowLoad);
      }

      window.removeEventListener('pointerdown', activateValidation);
      window.removeEventListener('keydown', activateValidation);
      window.removeEventListener('scroll', activateValidation);
    };
  }, [
    deferValidationUntilIdle,
    idleValidationActivated,
    validationActivationTimeoutMs,
  ]);

  useEffect(() => {
    if (!isHydrated || !isValidationActivated || cart.length === 0) return;

    const cartHash = createCartHash(cart);
    if (cartHash === lastValidatedCartHashRef.current) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      lastValidatedCartHashRef.current = cartHash;

      try {
        const validation = await validateStorefrontCart(
          cart,
          controller.signal
        );
        if (!validation || controller.signal.aborted) {
          return;
        }

        // A cart-wide negotiation distributes one agreed total across all
        // lines, so any validated price drift voids the whole group deal — not
        // just the changed line. Reset the flag and clear every line's
        // negotiated price (applyValidationResults only clears the drifted one).
        // A drifted price OR a removed (invalid) line both change the negotiated
        // cart composition, so either voids the whole group deal.
        const resetGroup =
          cartWideNegotiationActive &&
          ((validation.priceChanges?.length ?? 0) > 0 ||
            (validation.invalidProductIds?.length ?? 0) > 0);

        setCart((previousCart) => {
          let updatedCart = applyValidationResults(previousCart, validation);
          if (resetGroup) {
            updatedCart = updatedCart.map((item) =>
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
          lastValidatedCartHashRef.current = createCartHash(updatedCart);
          return updatedCart;
        });

        if (resetGroup) {
          cartWideNegotiationActiveRef.current = false;
          setCartWideNegotiationActiveState(false);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }

        logger.error({
          message: 'Cart validation error',
          error: error as Error,
        });
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cart, isHydrated, isValidationActivated, cartWideNegotiationActive]);

  useEffect(() => {
    if (isHydrated) {
      saveCartToStorage(cart, merchantSlug);
      saveCartWideNegotiationToStorage(cartWideNegotiationActive, merchantSlug);
    }
  }, [cart, cartWideNegotiationActive, isHydrated, merchantSlug]);

  useEffect(() => {
    return () => {
      if (upsellTimerRef.current) {
        clearTimeout(upsellTimerRef.current);
      }
    };
  }, []);

  const addToCart = (
    product: Product,
    quantity = 1,
    options?: AddToCartOptions
  ) => {
    const defaultVariantSelection =
      product.has_variants && !options?.variantId
        ? resolveDefaultVariantSelection(product)
        : null;
    const normalizedOptions =
      defaultVariantSelection && !options?.variantId
        ? {
            ...options,
            variantId: defaultVariantSelection.variant.id,
            variantAttributes: defaultVariantSelection.attributes,
            color: options?.color ?? defaultVariantSelection.color,
            condition: options?.condition ?? defaultVariantSelection.condition,
            storage: options?.storage ?? defaultVariantSelection.storage,
          }
        : options;
    const productForCart =
      defaultVariantSelection && !options?.variantId
        ? {
            ...product,
            price: defaultVariantSelection.price,
            compare_at_price:
              defaultVariantSelection.compareAtPrice ??
              product.compare_at_price,
            stock:
              resolveSerializedVariantStock(defaultVariantSelection.variant) ??
              defaultVariantSelection.variant.stock_quantity ??
              product.stock,
          }
        : product;

    // A quiz-prize voucher line redeems a unit that was already reserved for
    // this shopper at award mint (create_quiz_product_prize_award_with_inventory
    // decrements stock and pins a reserved order). Public stock can therefore be
    // 0 — e.g. the last serialized unit — so the out-of-stock guard must NOT
    // block the winner from adding their own prize.
    const isQuizPrizeVoucherLine = Boolean(
      normalizedOptions?.quizAwardId || normalizedOptions?.quizVoucherToken
    );
    if (
      !isQuizPrizeVoucherLine &&
      (productForCart.manage_stock ?? true) &&
      (productForCart.stock ?? 0) <= 0
    ) {
      logger.warn({
        message: 'Attempted to add out-of-stock product to cart',
        productId: productForCart.id,
        productName: productForCart.name,
        stock: productForCart.stock,
      });
      return 'rejected';
    }

    // Add-path caps (offer allocation + shared strict pool) live in
    // cart-stock-caps; the same caps cover fresh and merged adds.
    const addCaps = resolveSimpleLineAddCaps({
      product: productForCart,
      isVoucherLine: isQuizPrizeVoucherLine,
      variantId: normalizedOptions?.variantId,
      offerId: normalizedOptions?.offerId,
      stock: productForCart.stock,
    });

    if (product.has_variants && !normalizedOptions?.variantId) {
      logger.warn({
        message: 'Attempted to add variant product without selecting variant',
        productId: productForCart.id,
        productName: productForCart.name,
      });
      return 'rejected';
    }

    // The add-time assurance default must match the toggle the line
    // items render: they hide it unless the merchant context matches
    // the cart merchant and shipping insurance is enabled, so a
    // definite slug mismatch forces the default off rather than
    // charging a fee with no removal control.
    const contextMerchant = merchantContext?.merchant;
    const shippingInsuranceEnabled =
      contextMerchant?.slug != null &&
      merchantSlugRef.current != null &&
      contextMerchant.slug !== merchantSlugRef.current
        ? false
        : contextMerchant?.feature_settings?.shipping_insurance_enabled;

    const lineAddInput = {
      product,
      productForCart,
      normalizedOptions,
      quantity,
      caps: addCaps,
      assurance: {
        smartCartProEnabled: enableSmartCartPro,
        merchantSlug: merchantSlugRef.current,
        hasQuizVoucher: Boolean(
          normalizedOptions?.quizAwardId || normalizedOptions?.quizVoucherToken
        ),
        shippingInsuranceEnabled,
      },
    };
    // Probe the outcome against the serialized cart ref so callers can
    // gate success effects (upsell, toasts, analytics) on it, and advance
    // the ref on applied adds so batched same-tick adds observe each
    // other. The write below still runs through the updater against
    // committed state (preserving multi-writer safety with the
    // updater-based remove/edit paths); only a same-tick removal or
    // edit racing this add can skew the probe. That edge skips one
    // success toast while the cart badge still updates, and can leave
    // the group flag set after the updater stripped the lines — the
    // money paths key off per-line negotiatedPrice so no charged total
    // changes, and the next validation drift self-heals the flag.
    const probeResult = applyStorefrontCartLineAdd({
      previousCart: cartRef.current,
      ...lineAddInput,
    });
    const outcome: AddToCartOutcome =
      probeResult === cartRef.current ? 'rejected' : 'applied';
    if (outcome === 'applied') {
      cartRef.current = probeResult;
    }

    const wasGroupActive = cartWideNegotiationActiveRef.current;
    setCart((previousCart) => {
      const result = applyStorefrontCartLineAdd({
        previousCart,
        ...lineAddInput,
      });
      if (result === previousCart) {
        return previousCart;
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

    // A rejected add changes nothing, so the group deal survives it;
    // clearing the flag here would persist discounted lines under a
    // false inactive flag.
    if (wasGroupActive && outcome === 'applied') {
      setCartWideNegotiationActive(false);
    }

    if (outcome === 'applied' && enableSmartCartPro) {
      setLastAddedProduct(productForCart);
      upsellTimerRef.current = setTimeout(() => {
        setShowUpsell(true);
      }, 500);
    }
    return outcome;
  };

  const removeFromCart = (
    cartItemIdOrProductId: string,
    variantId?: string
  ) => {
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
    const wasGroupActive = cartWideNegotiationActiveRef.current;
    // Probe applied-ness synchronously, mirroring the add path: updaters
    // run later, so an in-updater flag would still read true at the gate
    // below. A missing target or a keepPrevious cap leaves the cart —
    // including per-line negotiated prices — untouched, so the group
    // deal must survive. Same-tick writers can skew the probe the way
    // they can the add probe; the updater stays authoritative for the
    // cart contents.
    const probeCart = cartRef.current;
    const probeIndex = findQuantityEditTargetIndex(
      probeCart,
      cartItemIdOrProductId,
      variantId
    );
    let editApplied = probeIndex !== -1;
    if (editApplied && quantity > 0) {
      const probeItem = probeCart[probeIndex];
      const probeMinimum = probeItem.minimum_order_quantity || 1;
      const probeQuantity = quantity < probeMinimum ? probeMinimum : quantity;
      editApplied = !(
        'keepPrevious' in
        capUpdatedSimpleLineQuantity({
          item: probeItem,
          cart: probeCart,
          excludeIndex: probeIndex,
          quantity: probeQuantity,
        })
      );
    }
    setCart((previousCart) => {
      const targetIndex = findQuantityEditTargetIndex(
        previousCart,
        cartItemIdOrProductId,
        variantId
      );

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
      let nextQuantity =
        quantity < minimumOrderQuantity ? minimumOrderQuantity : quantity;
      // Update-path caps (offer allocation + strict pool) live in
      // cart-stock-caps with the add-path rules.
      const capped = capUpdatedSimpleLineQuantity({
        item,
        cart: previousCart,
        excludeIndex: targetIndex,
        quantity: nextQuantity,
      });
      if ('keepPrevious' in capped) {
        return previousCart;
      }
      nextQuantity = capped.quantity;
      nextCart[targetIndex] = {
        ...item,
        quantity: nextQuantity,
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
    if (wasGroupActive && editApplied) {
      setCartWideNegotiationActive(false);
    }
  };

  const clearCart = () => {
    // Clear persisted state against the active merchant slug first — the
    // persistence effect runs after `merchantSlug` is nulled, so it would
    // otherwise write the cleared cart against the default key and leave the
    // merchant-scoped cart/group-negotiation state to rehydrate on refresh.
    const slugToClear = merchantSlug;
    saveCartToStorage([], slugToClear);
    saveCartWideNegotiationToStorage(false, slugToClear);
    setCart([]);
    // Keep the serialized add-probe ref aligned: a same-tick add after
    // this clear must probe against the empty cart, not the stale one.
    cartRef.current = [];
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
    const merchantCartState = getMerchantCartState(slug);
    setMerchantSlugState(slug);
    setCart(merchantCartState.cart);
    // Same-tick adds after a merchant switch must probe against the
    // newly loaded cart, not the previous merchant's lines.
    cartRef.current = merchantCartState.cart;
    setCartWideNegotiationActive(merchantCartState.cartWideNegotiationActive);
    saveMerchantSlugToStorage(slug);
  };

  const applyNegotiatedPrice = (cartItemId: string, newPrice: number) => {
    if (!enableSmartCartPro) return;
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
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

'use client';

import { resolveAssuranceMerchantSetting } from '@baci/shared/lib';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { MerchantContextType } from '@/hooks/merchant/types';
import type { Product } from '@/lib/products';
import { applyStorefrontCartLineAdd } from './cart-line-add';
import {
  capUpdatedSimpleLineQuantity,
  resolveSimpleLineAddCaps,
} from './cart-stock-caps';
import type {
  AddToCartOptions,
  AddToCartOutcome,
  CartItem,
} from './cart-types';
import { gateAddToCart } from './gate-add-to-cart';
import type { useStorefrontCartDelegation } from './use-storefront-cart-delegation';

type DelegatedActions = ReturnType<
  typeof useStorefrontCartDelegation
>['delegatedActions'];

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

/** Legacy/delegated line mutations and merchant binding for the provider. */
export function useStorefrontCartLineHandlers({
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
}: {
  cartRef: RefObject<CartItem[]>;
  cartWideNegotiationActiveRef: RefObject<boolean>;
  delegated: boolean;
  delegatedActions: DelegatedActions;
  enableSmartCartPro: boolean;
  merchantContext: MerchantContextType | null;
  merchantSlugRef: RefObject<string | null>;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setCartWideNegotiationActive: (active: boolean) => void;
  setLastAddedProduct: Dispatch<SetStateAction<Product | null>>;
  setShowUpsell: Dispatch<SetStateAction<boolean>>;
  upsellTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
}) {
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
  ): AddToCartOutcome => {
    const gated = gateAddToCart(product, options);
    if (!gated) return 'rejected';
    const productForCart = gated.product;
    const normalizedOptions = gated.options;

    if (delegated) {
      const accepted = delegatedActions.addToCart(
        productForCart,
        quantity,
        normalizedOptions
      );
      if (accepted) noteAddedProduct(productForCart);
      return accepted ? 'applied' : 'rejected';
    }

    const isQuizPrizeVoucherLine = Boolean(
      normalizedOptions?.quizAwardId || normalizedOptions?.quizVoucherToken
    );
    // Add-path caps (offer allocation + shared strict pool) live in
    // cart-stock-caps; the same caps cover fresh and merged adds.
    const addCaps = resolveSimpleLineAddCaps({
      product: productForCart,
      isVoucherLine: isQuizPrizeVoucherLine,
      variantId: normalizedOptions?.variantId,
      offerId: normalizedOptions?.offerId,
      stock: productForCart.stock,
    });

    // The add-time assurance default must match the toggle the line
    // items render (see the shared setting resolver): a definite slug
    // mismatch forces the default off rather than charging a fee with
    // no removal control.
    const contextMerchant = merchantContext?.merchant;
    const shippingInsuranceEnabled = resolveAssuranceMerchantSetting({
      contextSlug: contextMerchant?.slug,
      contextSetting:
        contextMerchant?.feature_settings?.shipping_insurance_enabled,
      cartSlug: merchantSlugRef.current,
    });

    const lineAddInput = {
      product,
      productForCart,
      normalizedOptions,
      quantity,
      caps: addCaps,
      assurance: {
        smartCartProEnabled: enableSmartCartPro,
        merchantSlug: merchantSlugRef.current,
        hasQuizVoucher: isQuizPrizeVoucherLine,
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

    if (outcome === 'applied') {
      noteAddedProduct(productForCart);
    }
    return outcome;
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

  return {
    addToCart,
    removeFromCart,
    updateQuantity,
  };
}

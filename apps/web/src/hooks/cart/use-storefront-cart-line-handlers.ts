'use client';

import { resolveAssuranceMerchantSetting } from '@baci/shared/lib';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { MerchantContextType } from '@/hooks/merchant/types';
import type { Product } from '@/lib/products';
import { applyStorefrontCartLineAdd } from './cart-line-add';
import {
  applyStorefrontCartQuantityEdit,
  probeQuantityEditApplied,
} from './cart-quantity-edit';
import { resolveSimpleLineAddCaps } from './cart-stock-caps';
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
    // Probe applied-ness synchronously (see cart-quantity-edit): a
    // missing target or a keepPrevious cap leaves the group deal intact.
    const editApplied = probeQuantityEditApplied({
      cart: cartRef.current,
      cartItemIdOrProductId,
      variantId,
      quantity,
    });
    setCart((previousCart) =>
      applyStorefrontCartQuantityEdit({
        previousCart,
        cartItemIdOrProductId,
        variantId,
        quantity,
        wasGroupActive,
      })
    );
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

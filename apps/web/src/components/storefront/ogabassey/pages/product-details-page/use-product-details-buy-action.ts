'use client';

import type { Route } from 'next';
import type { ResolvedProductVariantSelection } from '@baci/shared/lib';
import { useEffect, useRef, type RefObject } from 'react';
import type { useCart } from '@/hooks/cart';
import type { useToast } from '@/hooks/use-toast';
import { asRoute } from '@/lib/routes';
import type { Product } from '../../types';
import {
  buildCartProduct,
  type ConditionType,
  type NormalizedProductDetails,
} from './product-details-helpers';
import { resolveCurrentOffer } from './offer-resolution';

type ProductVariantSelection =
  | ResolvedProductVariantSelection<NonNullable<Product['variants']>[number]>
  | null;

interface UseProductDetailsBuyActionParams {
  addToCart: ReturnType<typeof useCart>['addToCart'];
  basePath: string;
  checkoutRedirectTimeoutRef: RefObject<number | null>;
  productData: NormalizedProductDetails;
  routeOfferId?: string | null;
  routeResolvedVariantSelection: ProductVariantSelection;
  selectedCondition: ConditionType;
  routerPush: (href: Route) => void;
  searchParams: { get(name: string): string | null };
  serverProduct: Product;
  toast: ReturnType<typeof useToast>['toast'];
}

export function useProductDetailsBuyAction({
  addToCart,
  basePath,
  checkoutRedirectTimeoutRef,
  productData,
  routeOfferId,
  routeResolvedVariantSelection,
  selectedCondition,
  routerPush,
  searchParams,
  serverProduct,
  toast,
}: UseProductDetailsBuyActionParams) {
  const buyActionHandled = useRef(false);

  useEffect(() => {
    return () => {
      if (checkoutRedirectTimeoutRef.current !== null) {
        window.clearTimeout(checkoutRedirectTimeoutRef.current);
        checkoutRedirectTimeoutRef.current = null;
      }
    };
  }, [checkoutRedirectTimeoutRef]);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action !== 'buy' || buyActionHandled.current) {
      return;
    }

    buyActionHandled.current = true;
    const selectedVariantSelection = routeResolvedVariantSelection;
    // The resolved selection condition (derived from a live offer id for
    // ID-only links) seeds non-variant buys: falling back to 'new' would
    // reject the route offer in the condition-gated resolver and add the
    // parent/default instead of the advertised option.
    const buyCondition =
      (selectedVariantSelection?.condition as ConditionType | undefined) ??
      selectedCondition;
    const selectedAttributesForBuy = selectedVariantSelection?.attributes || {};
    const defaultColorIndex =
      selectedVariantSelection?.color != null
        ? productData.colors.findIndex(
            (color) => color.name === selectedVariantSelection.color
          )
        : -1;

    // Capture the resolved offer once: its id identifies the cart line
    // so two offers that canonicalize alike never merge into one line.
    const resolvedBuyOffer = resolveCurrentOffer(
      productData,
      buyCondition,
      selectedAttributesForBuy,
      selectedVariantSelection,
      routeOfferId
    );
    addToCart(
      buildCartProduct(
        productData,
        resolvedBuyOffer,
        defaultColorIndex >= 0 ? defaultColorIndex : 0,
        buyCondition,
        selectedAttributesForBuy,
        selectedVariantSelection?.color,
        { hasVariantPricing: selectedVariantSelection?.variant != null }
      ),
      1,
      {
        ...selectedAttributesForBuy,
        variantId: selectedVariantSelection?.variant.id,
        variantAttributes: selectedAttributesForBuy,
        color: selectedVariantSelection?.color,
        storage: selectedVariantSelection?.storage,
        condition: buyCondition,
        offerId: resolvedBuyOffer.offerId ?? undefined,
      }
    );
    toast({
      title: 'Added to cart',
      description: `${serverProduct.name} has been added to your cart.`,
    });
    if (checkoutRedirectTimeoutRef.current !== null) {
      window.clearTimeout(checkoutRedirectTimeoutRef.current);
    }
    // Route through the cart, not checkout (mirrors the generic PDP): the
    // cart carries the optional-service (assurance) disclosure and toggle,
    // so a direct checkout redirect would let a default-on fee reach
    // payment without presenting the choice.
    checkoutRedirectTimeoutRef.current = window.setTimeout(() => {
      checkoutRedirectTimeoutRef.current = null;
      routerPush(asRoute(basePath ? `${basePath}/cart` : '/cart'));
    }, 500);
  }, [
    addToCart,
    basePath,
    checkoutRedirectTimeoutRef,
    productData,
    routeOfferId,
    routeResolvedVariantSelection,
    routerPush,
    selectedCondition,
    searchParams,
    serverProduct,
    toast,
  ]);
}

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
  routeResolvedVariantSelection: ProductVariantSelection;
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
  routeResolvedVariantSelection,
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
    const selectedAttributesForBuy = selectedVariantSelection?.attributes || {};
    const defaultColorIndex =
      selectedVariantSelection?.color != null
        ? productData.colors.findIndex(
            (color) => color.name === selectedVariantSelection.color
          )
        : -1;

    addToCart(
      buildCartProduct(
        productData,
        resolveCurrentOffer(
          productData,
          (selectedVariantSelection?.condition as ConditionType | undefined) ||
            'new',
          selectedAttributesForBuy,
          selectedVariantSelection
        ),
        defaultColorIndex >= 0 ? defaultColorIndex : 0,
        (selectedVariantSelection?.condition as ConditionType | undefined) ||
          'new',
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
        condition:
          (selectedVariantSelection?.condition as ConditionType | undefined) ||
          'new',
      }
    );
    toast({
      title: 'Added to cart',
      description: `${serverProduct.name} has been added to your cart.`,
    });
    if (checkoutRedirectTimeoutRef.current !== null) {
      window.clearTimeout(checkoutRedirectTimeoutRef.current);
    }
    checkoutRedirectTimeoutRef.current = window.setTimeout(() => {
      checkoutRedirectTimeoutRef.current = null;
      routerPush(asRoute(basePath ? `${basePath}/checkout` : '/checkout'));
    }, 500);
  }, [
    addToCart,
    basePath,
    checkoutRedirectTimeoutRef,
    productData,
    routeResolvedVariantSelection,
    routerPush,
    searchParams,
    serverProduct,
    toast,
  ]);
}

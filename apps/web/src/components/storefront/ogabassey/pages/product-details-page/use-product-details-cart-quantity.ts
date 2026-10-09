'use client';

import { useState } from 'react';
import type { useCart } from '@/hooks/cart';
import {
  buildCartItemId,
  type ConditionType,
  type NormalizedProductDetails,
} from './product-details-helpers';

interface UseProductDetailsCartQuantityParams {
  cart: ReturnType<typeof useCart>['cart'];
  currentOfferId?: string | null;
  currentVariantId?: string;
  productData: NormalizedProductDetails;
  secondaryColor: number | null;
  selectedAttributes: Record<string, string>;
  selectedColor: number | null;
  selectedCondition: ConditionType;
}

export function useProductDetailsCartQuantity({
  cart,
  currentOfferId,
  currentVariantId,
  productData,
  secondaryColor,
  selectedAttributes,
  selectedColor,
  selectedCondition,
}: UseProductDetailsCartQuantityParams) {
  const currentCartItemId = buildCartItemId(productData.id, {
    color:
      selectedColor !== null
        ? productData.colors[selectedColor]?.name
        : undefined,
    secondaryColor:
      secondaryColor !== null
        ? productData.colors[secondaryColor]?.name
        : undefined,
    condition: selectedCondition,
    offerId: currentOfferId ?? undefined,
    variantId: currentVariantId,
    selectedAttributes,
  });

  const cartItem = currentCartItemId
    ? cart.find((item) => {
        if (item.cartItemId === currentCartItemId) return true;
        // Legacy fallback: match items stored with old - separator format.
        return Boolean(
          item.cartItemId &&
            item.cartItemId.includes('-') &&
            !item.cartItemId.includes('::') &&
            item.id === productData.id
        );
      })
    : undefined;
  const quantityInCart = cartItem?.quantity || 0;
  const [inputValue, setInputValue] = useState(() =>
    quantityInCart > 0 ? String(quantityInCart) : ''
  );
  const [prevQuantityInCart, setPrevQuantityInCart] = useState(quantityInCart);

  if (quantityInCart !== prevQuantityInCart) {
    setPrevQuantityInCart(quantityInCart);
    setInputValue(quantityInCart > 0 ? String(quantityInCart) : '');
  }

  return {
    currentCartItemId,
    inputValue,
    quantityInCart,
    setInputValue,
  };
}

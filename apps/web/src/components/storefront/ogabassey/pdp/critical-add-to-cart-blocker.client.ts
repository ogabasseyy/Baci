'use client';

import { useState } from 'react';
import {
  resolveCriticalAddToCartBlocker,
  revealCriticalAddToCartBlocker,
} from './critical-add-to-cart-blocker';

interface UseCriticalAddToCartBlockerInput {
  canAddToCart: boolean;
  maxQuantity: number | null;
  missingAxes: string[];
  missingHiddenAxes: string[];
  routeOfferMissingActive: boolean;
  submitAddToCart: () => void;
  visibleAxes: string[];
}

/**
 * Owns what happens when Add to cart is tapped. A blocked tap never
 * fails silently: it states the reason beside the button and brings
 * the missing option group into view.
 */
export function useCriticalAddToCartBlocker({
  submitAddToCart,
  ...blockerInput
}: UseCriticalAddToCartBlockerInput) {
  const addToCartBlocker = resolveCriticalAddToCartBlocker(blockerInput);
  const [addToCartBlockedAttempt, setAddToCartBlockedAttempt] =
    useState(false);

  function handleAddToCart(event?: { currentTarget: Element }) {
    if (addToCartBlocker) {
      setAddToCartBlockedAttempt(true);
      revealCriticalAddToCartBlocker(addToCartBlocker, event?.currentTarget);
      return;
    }

    submitAddToCart();
  }

  return {
    addToCartBlockedAttempt,
    addToCartBlocker,
    clearAddToCartBlockedAttempt: () => setAddToCartBlockedAttempt(false),
    handleAddToCart,
  };
}

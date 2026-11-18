'use client';

import { useState } from 'react';
import { resolveCriticalAddToCartBlocker } from './critical-add-to-cart-blocker';
import { revealCriticalAddToCartBlocker } from './reveal-critical-add-to-cart-blocker';

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
  // Counts blocked taps since the last choice, so every tap (not only
  // the first) refreshes the announced reason.
  const [addToCartBlockedAttempt, setAddToCartBlockedAttempt] = useState(0);

  function handleAddToCart(event?: { currentTarget: Element }) {
    if (addToCartBlocker) {
      setAddToCartBlockedAttempt((count) => count + 1);
      revealCriticalAddToCartBlocker(addToCartBlocker, event?.currentTarget);
      return;
    }

    submitAddToCart();
  }

  return {
    addToCartBlockedAttempt,
    addToCartBlocker,
    clearAddToCartBlockedAttempt: () => setAddToCartBlockedAttempt(0),
    handleAddToCart,
  };
}

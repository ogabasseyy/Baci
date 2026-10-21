'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * Exact-variant links whose variant is gone must not silently sell the
 * default variant instead: purchase stays blocked until the shopper
 * explicitly picks attributes, which dismisses the missing state.
 * Returns the active flag, the purchase gate, and a wrapped attribute
 * setter for the selection panels.
 */
export function useRouteVariantMissing(
  routeVariantMissing: boolean,
  canPurchase: boolean,
  setSelectedAttributes: Dispatch<SetStateAction<Record<string, string>>>
) {
  const [dismissed, setDismissed] = useState(false);
  const active = routeVariantMissing && !dismissed;
  const handleSetAttributes: typeof setSelectedAttributes = (value) => {
    setDismissed(true);
    setSelectedAttributes(value);
  };
  return {
    effectiveCanPurchase: canPurchase && !active,
    handleSetAttributes,
    routeVariantMissingActive: active,
  };
}

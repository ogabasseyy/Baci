'use client';

import { useState } from 'react';
import type { ConditionType } from './product-details-helpers';

/**
 * Exact-offer links whose offer is gone must not silently sell the
 * parent/default selection instead: purchase stays blocked until the
 * shopper explicitly picks a condition, which dismisses the missing
 * state. Returns the active flag, the purchase gate, and a wrapped
 * condition setter for the panels.
 */
export function useRouteOfferMissing(
  routeOfferMissing: boolean,
  canPurchase: boolean,
  setSelectedCondition: (condition: ConditionType) => void
) {
  const [dismissed, setDismissed] = useState(false);
  const active = routeOfferMissing && !dismissed;
  const handleSetCondition = (condition: ConditionType) => {
    setDismissed(true);
    setSelectedCondition(condition);
  };
  return {
    effectiveCanPurchase: canPurchase && !active,
    handleSetCondition,
    routeOfferMissingActive: active,
  };
}

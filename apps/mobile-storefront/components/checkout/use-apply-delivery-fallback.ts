import {
  type DeliveryFallbackInput,
  resolveDeliveryFallback,
} from './checkout-door-fallback';
import type { DeliveryMethod } from './types';

export interface ApplyDeliveryFallbackInput extends DeliveryFallbackInput {
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
}

/**
 * Render-phase fallback sync for `useCheckoutShipping`: methods that lose
 * their location or eligibility revert to door (with the quote re-resolved).
 * The guard only applies updates when the method actually changes, so the
 * updates always settle instead of looping.
 */
export function useApplyDeliveryFallback({
  setDeliveryMethod,
  setSelectedQuoteId,
  ...input
}: ApplyDeliveryFallbackInput): void {
  const fallback = resolveDeliveryFallback(input);
  if (fallback.deliveryMethod !== input.deliveryMethod) {
    setDeliveryMethod(fallback.deliveryMethod);
    setSelectedQuoteId(fallback.selectedQuoteId);
  }
}

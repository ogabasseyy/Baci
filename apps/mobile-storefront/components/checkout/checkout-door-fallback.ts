import { isAirportDeliveryEligible, isStoreOriginDelivery } from '@baci/shared';
import {
  findSelectedQuote,
  isGiglGoFasterQuote,
  resolveDoorDeliveryQuoteId,
} from '@/components/checkout/checkout-step-helpers';
import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';

export interface DeliveryFallbackInput {
  canUsePickupStation: boolean;
  deliveryMethod: DeliveryMethod;
  hasResolvedDeliveryLocation: boolean;
  selectedQuoteId: string;
  shippingQuotes: ShippingQuote[];
  watchedCity: string;
  watchedState: string;
}

export interface DeliveryFallback {
  deliveryMethod: DeliveryMethod;
  selectedQuoteId: string;
}

export interface ApplyDeliveryFallbackInput extends DeliveryFallbackInput {
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
}

/**
 * Resolve the render-phase delivery fallback: methods that lose their
 * location or eligibility (unresolved address, ineligible airport, or
 * unavailable pickup station) fall back to door. The quote selection is
 * re-resolved alongside the method so a stale air (GoFaster) or station
 * quote never survives the fallback — door pricing treats it as zero while
 * the order builder could still send its ID.
 */
export function resolveDeliveryFallback({
  canUsePickupStation,
  deliveryMethod,
  hasResolvedDeliveryLocation,
  selectedQuoteId,
  shippingQuotes,
  watchedCity,
  watchedState,
}: DeliveryFallbackInput): DeliveryFallback {
  if (
    (deliveryMethod !== 'door' && !hasResolvedDeliveryLocation) ||
    (deliveryMethod === 'airport' &&
      !isAirportDeliveryEligible(watchedState) &&
      (!isGiglGoFasterQuote(
        findSelectedQuote(shippingQuotes, selectedQuoteId)
      ) ||
        isStoreOriginDelivery(watchedCity, watchedState))) ||
    (deliveryMethod === 'pickup_station' && !canUsePickupStation)
  ) {
    return {
      deliveryMethod: 'door',
      selectedQuoteId: resolveDoorDeliveryQuoteId(
        shippingQuotes,
        selectedQuoteId
      ),
    };
  }
  return { deliveryMethod, selectedQuoteId };
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

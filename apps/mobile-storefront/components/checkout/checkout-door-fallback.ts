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
      (isStoreOriginDelivery(watchedCity, watchedState) ||
        (!isAirportDeliveryEligible(watchedState) &&
          !isGiglGoFasterQuote(
            findSelectedQuote(shippingQuotes, selectedQuoteId)
          )))) ||
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

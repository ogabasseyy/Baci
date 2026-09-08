import type { DeliveryMethod } from './types';

/** Door carriers need a street; merchant pickup can quote from city/state alone. */
export function shouldFetchCheckoutShippingQuotes(input: {
  deliveryMethod: DeliveryMethod;
  isStreetReady: boolean;
  hasCityState: boolean;
}): boolean {
  if (input.deliveryMethod === 'pickup_station') {
    return input.hasCityState;
  }
  if (
    input.deliveryMethod === 'door' ||
    input.deliveryMethod === 'airport'
  ) {
    return input.isStreetReady;
  }
  return false;
}

/**
 * Discover merchant/station pickup rates from city/state before the shopper
 * leaves the default `door` method (Lagos hides `pickup_station` until a quote
 * exists).
 */
export function shouldDiscoverCheckoutPickupQuotes(input: {
  isStreetReady: boolean;
  hasCityState: boolean;
}): boolean {
  return input.hasCityState && !input.isStreetReady;
}

/** Prefer pickup discovery when the street is incomplete. */
export function checkoutShippingQuoteDeliveryPreference(input: {
  deliveryMethod: DeliveryMethod;
  isStreetReady: boolean;
}): 'door' | 'pickup_station' {
  if (input.deliveryMethod === 'pickup_station' || !input.isStreetReady) {
    return 'pickup_station';
  }
  return 'door';
}

import type { DeliveryMethod } from './types';

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

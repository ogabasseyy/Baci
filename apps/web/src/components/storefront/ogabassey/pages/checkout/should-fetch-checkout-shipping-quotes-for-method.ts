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

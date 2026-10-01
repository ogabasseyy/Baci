import type { ShippingQuote } from './types';

export function isStationPickupQuote(quote: ShippingQuote): boolean {
  return quote.isStationPickup === true;
}

import type { ShippingQuote } from './types';

export function getStationPickupAddressText(quote: ShippingQuote): string {
  return [quote.stationName, quote.stationAddress]
    .filter((line): line is string => Boolean(line))
    .join(', ');
}

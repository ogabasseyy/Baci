import type { ShippingQuote } from './types';
import { isStationPickupQuote } from './is-station-pickup-quote';

export function getStationPickupQuote(
  quotes: ShippingQuote[],
): ShippingQuote | undefined {
  return quotes.find(isStationPickupQuote);
}

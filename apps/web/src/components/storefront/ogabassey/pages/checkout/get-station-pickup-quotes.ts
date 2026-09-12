import type { ShippingQuote } from './types';
import { isStationPickupQuote } from './is-station-pickup-quote';

/**
 * All station-pickup quotes (carrier stations AND merchant pickup rates), in
 * quote order. A merchant can configure several pickup locations in one zone;
 * each surfaces as its own station-pickup quote with a distinct `mrate_<uuid>`
 * id, so the checkout must be able to list and select every one of them rather
 * than collapsing to the first via `getStationPickupQuote`.
 */
export function getStationPickupQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(isStationPickupQuote);
}

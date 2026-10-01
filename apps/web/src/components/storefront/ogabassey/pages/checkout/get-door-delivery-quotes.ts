import type { ShippingQuote } from './types';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
import { isStationPickupQuote } from './is-station-pickup-quote';

export function getDoorDeliveryQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(
    (quote) =>
      !isStationPickupQuote(quote) && !isGiglGoFasterQuote(quote),
  );
}

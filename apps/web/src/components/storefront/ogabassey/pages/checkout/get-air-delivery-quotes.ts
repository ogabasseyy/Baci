import type { ShippingQuote } from './types';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';

export function getAirDeliveryQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(isGiglGoFasterQuote);
}

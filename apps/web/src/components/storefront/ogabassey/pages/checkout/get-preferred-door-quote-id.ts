import type { ShippingQuote } from './types';
import { getDoorDeliveryQuotes } from './get-door-delivery-quotes';

export function getPreferredDoorQuoteId(quotes: ShippingQuote[]): string {
  return getDoorDeliveryQuotes(quotes)[0]?.id ?? '';
}

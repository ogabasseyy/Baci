import type { DeliveryMethod, ShippingQuote } from './types';
import { getPreferredDoorQuoteId } from './get-preferred-door-quote-id';
import { getStationPickupQuote } from './get-station-pickup-quote';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
import { isStationPickupQuote } from './is-station-pickup-quote';

export function getSelectedQuoteIdForDeliveryMethod(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
  shippingQuotes: ShippingQuote[],
): string {
  if (deliveryMethod === 'pickup_station') {
    // Preserve an already-selected pickup quote so a shopper who picks the
    // second of several merchant pickup locations, leaves the tab, and returns
    // isn't silently reset to the first one.
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return selectedQuote && isStationPickupQuote(selectedQuote)
      ? selectedQuoteId
      : (getStationPickupQuote(shippingQuotes)?.id ?? '');
  }

  if (deliveryMethod === 'door') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return selectedQuote &&
      !isStationPickupQuote(selectedQuote) &&
      !isGiglGoFasterQuote(selectedQuote)
      ? selectedQuoteId
      : getPreferredDoorQuoteId(shippingQuotes);
  }

  if (deliveryMethod === 'airport') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return isGiglGoFasterQuote(selectedQuote) ? selectedQuoteId : '';
  }

  return selectedQuoteId;
}

import { AIRPORT_DELIVERY_FEES } from '@baci/shared/constants';
import type { DeliveryMethod, ShippingQuote } from './types';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
import { isStationPickupQuote } from './is-station-pickup-quote';

/** Calculate the delivery cost based on the selected method and quote. */
export function calculateDeliveryCost(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
  shippingQuotes: ShippingQuote[],
  airportType: 'delivery' | 'pickup',
): number {
  if (deliveryMethod === 'pickup') return 0;

  if (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') {
    if (!selectedQuoteId) return 0;
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    if (!selectedQuote) return 0;
    if (deliveryMethod === 'door' && isStationPickupQuote(selectedQuote)) {
      return 0;
    }
    if (
      deliveryMethod === 'pickup_station' &&
      !isStationPickupQuote(selectedQuote)
    ) {
      return 0;
    }
    return selectedQuote.price;
  }

  const selectedAirQuote = shippingQuotes.find(
    (quote) => String(quote.id) === String(selectedQuoteId),
  );
  if (selectedAirQuote && isGiglGoFasterQuote(selectedAirQuote)) {
    return selectedAirQuote.price;
  }
  return AIRPORT_DELIVERY_FEES[airportType];
}

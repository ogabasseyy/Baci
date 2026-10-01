import { isAirportDeliveryEligible } from '@baci/shared';
import {
  getPickupStationMode,
  getStationPickupQuote,
  isProviderStationPickupQuote,
} from './checkout-station-pickup';
import {
  AIRPORT_DELIVERY_ESTIMATE,
  AIRPORT_DELIVERY_FEE,
  AIRPORT_QUOTE_ID,
  isGiglGoFasterQuote,
} from './checkout-step-helpers';
import type { DeliveryMethod, ShippingQuote } from './types';

interface CheckoutAddressShippingOptionsParams {
  deliveryMethod: DeliveryMethod;
  selectedQuote: ShippingQuote | undefined;
  selectedQuoteId: string;
  shippingQuotes: ShippingQuote[];
  watchedCity: string;
  watchedState: string;
}

export function getCheckoutAddressShippingOptions({
  deliveryMethod,
  selectedQuote,
  selectedQuoteId,
  shippingQuotes,
  watchedCity,
  watchedState,
}: CheckoutAddressShippingOptionsParams) {
  const stationPickupQuote = getStationPickupQuote(shippingQuotes);
  const doorSelectedQuote =
    selectedQuote != null &&
    !isProviderStationPickupQuote(selectedQuote) &&
    !isGiglGoFasterQuote(selectedQuote)
      ? selectedQuote
      : undefined;
  const doorShippingQuotes = shippingQuotes.filter(
    (quote) =>
      !isProviderStationPickupQuote(quote) && !isGiglGoFasterQuote(quote)
  );
  const airShippingQuotes = shippingQuotes.filter(isGiglGoFasterQuote);
  const providerPickupQuotes = shippingQuotes.filter(
    isProviderStationPickupQuote
  );
  const pickupMode = getPickupStationMode({
    city: watchedCity,
    deliveryMethod,
    state: watchedState,
    stationPickupQuote,
  });
  const airportLocation = watchedCity.trim() || watchedState.trim();
  const localAirportQuote = isAirportDeliveryEligible(watchedState)
    ? {
        carrierName: 'By Air',
        deliveryRange: AIRPORT_DELIVERY_ESTIMATE,
        displayName: `${airportLocation ? `${airportLocation} ` : ''}Airport Delivery`,
        id: AIRPORT_QUOTE_ID,
        price: AIRPORT_DELIVERY_FEE,
      }
    : undefined;
  const effectiveSelectedQuoteId =
    deliveryMethod === 'airport' && !isGiglGoFasterQuote(selectedQuote)
      ? AIRPORT_QUOTE_ID
      : selectedQuoteId;

  return {
    airShippingQuotes,
    doorSelectedQuote,
    doorShippingQuotes,
    effectiveSelectedQuoteId,
    localAirportQuote,
    providerPickupQuotes,
    stationPickupQuote,
    ...pickupMode,
  };
}

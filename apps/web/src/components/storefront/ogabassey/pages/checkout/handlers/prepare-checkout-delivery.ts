import { getCountryByCode } from '@/lib/countries';
import type { ShippingQuote } from '@/types/shipping-quote';
import { getMerchantRateId } from '../get-merchant-rate-id';
import { getStationPickupAddressText } from '../get-station-pickup-address-text';
import { resolveAirportShippingAddress } from '../resolve-airport-shipping-address';
import type { DeliveryMethod, SavedAddress } from '../types';

interface PrepareCheckoutDeliveryInput {
  method: DeliveryMethod;
  selectedQuoteId: string;
  selectedQuoteMatchesMethod: boolean;
  airportRequiresQuote: boolean;
  quotes: ShippingQuote[];
  selectedAddress?: SavedAddress;
  isNewAddressMode: boolean;
  newAddressStreet: string;
  newAddressCity: string;
  newAddressState: string;
  airportType: 'delivery' | 'pickup';
  customerPhone: string;
  merchantCountry: string;
}

export type CheckoutDeliveryIssue =
  | 'required'
  | 'expired'
  | 'incomplete-address';

export interface PreparedCheckoutDelivery {
  address: {
    address: string;
    city: string;
    state: string;
    phone: string;
    countryCode: string;
    country: string;
  };
  merchantRateId: string | null;
  provider: string | null;
  issue: CheckoutDeliveryIssue | null;
}

/** Resolve address and quote fields for a fresh order without changing checkout state. */
export function prepareCheckoutDelivery({
  method,
  selectedQuoteId,
  selectedQuoteMatchesMethod,
  airportRequiresQuote,
  quotes,
  selectedAddress,
  isNewAddressMode,
  newAddressStreet,
  newAddressCity,
  newAddressState,
  airportType,
  customerPhone,
  merchantCountry,
}: PrepareCheckoutDeliveryInput): PreparedCheckoutDelivery {
  const selectedQuote = quotes.find(
    (quote) => String(quote.id) === String(selectedQuoteId)
  );
  let address = 'Address not provided';
  let city = '';
  let state = '';

  if (method === 'door') {
    if (isNewAddressMode) {
      if (!newAddressStreet || !newAddressCity || !newAddressState) {
        return {
          address: makeDelivery('', '', '', customerPhone, merchantCountry),
          merchantRateId: null,
          provider: null,
          issue: 'incomplete-address',
        };
      }
      address = newAddressStreet;
      city = newAddressCity;
      state = newAddressState;
    } else {
      address = selectedAddress?.address || 'Address not provided';
      const parts = address.split(',');
      if (parts.length >= 2) {
        state = parts[parts.length - 1]?.trim() || '';
        city = parts[parts.length - 2]?.trim() || '';
      }
    }
  } else if (method === 'pickup_station') {
    address =
      (selectedQuote && getStationPickupAddressText(selectedQuote)) ||
      selectedQuote?.displayName ||
      'GIGL pickup station';
    city = newAddressCity;
    state = newAddressState;
    if ((!city || !state) && selectedAddress?.address) {
      const parts = selectedAddress.address.split(',');
      if (parts.length >= 2) {
        city ||= parts[parts.length - 2]?.trim() || '';
        state ||= parts[parts.length - 1]?.trim() || '';
      }
    }
  } else if (method === 'pickup') {
    address = 'Pickup at Store';
    city = 'Lagos';
    state = 'Lagos';
  } else {
    const airportAddress = resolveAirportShippingAddress({
      airportType,
      manualAddress: newAddressStreet,
      manualCity: newAddressCity,
      manualState: newAddressState,
      savedAddress: selectedAddress?.address,
    });
    address = airportAddress.address;
    city = airportAddress.city;
    state = airportAddress.state;
  }

  const merchantRateId =
    method === 'door' || method === 'pickup_station'
      ? getMerchantRateId(selectedQuoteId)
      : null;
  const needsQuote = method === 'door' || method === 'pickup_station';
  const forwardsAirportQuote =
    method === 'airport' && selectedQuoteMatchesMethod;
  let issue: CheckoutDeliveryIssue | null = null;
  let provider: string | null = null;

  if (
    (needsQuote && !selectedQuoteId) ||
    (method === 'airport' &&
      airportRequiresQuote &&
      !selectedQuoteMatchesMethod)
  ) {
    issue = 'required';
  } else if ((needsQuote || forwardsAirportQuote) && selectedQuoteId) {
    if (selectedQuote && selectedQuoteMatchesMethod) {
      provider = merchantRateId ? null : selectedQuote.provider;
    } else {
      issue = 'expired';
    }
  }

  return {
    address: makeDelivery(
      address,
      city,
      state,
      customerPhone || selectedAddress?.phone || '',
      merchantCountry
    ),
    merchantRateId,
    provider,
    issue,
  };
}

function makeDelivery(
  address: string,
  city: string,
  state: string,
  phone: string,
  countryCode: string
) {
  return {
    address,
    city,
    state,
    phone,
    countryCode,
    country: getCountryByCode(countryCode)?.name ?? 'Nigeria',
  };
}

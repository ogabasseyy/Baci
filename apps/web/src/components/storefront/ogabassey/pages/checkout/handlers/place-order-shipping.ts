import { getStationPickupAddressText, isStationPickupQuote } from '../utils';
import type { DeliveryMethod, ShippingQuote } from '../types';
import type { PlaceOrderOptions } from './place-order-types';

export function buildShippingAddress(opts: PlaceOrderOptions) {
  const {
    deliveryMethod,
    isNewAddressMode,
    newAddressStreet,
    newAddressCity,
    newAddressState,
    selectedAddressId,
    addresses,
    airportType,
    customerPhone,
    selectedQuoteId,
    shippingQuotes,
  } = opts;

  let finalAddress = 'Address not provided';
  let finalCity = '';
  let finalState = '';
  const selectedAddress = addresses.find((a) => a.id === selectedAddressId);

  if (deliveryMethod === 'door') {
    if (isNewAddressMode) {
      finalAddress = `${newAddressStreet}, ${newAddressCity}, ${newAddressState}`;
      finalCity = newAddressCity;
      finalState = newAddressState;
    } else {
      finalAddress = selectedAddress?.address || 'Address not provided';
      const parts = finalAddress.split(',');
      if (parts.length >= 2) {
        finalState = parts[parts.length - 1]?.trim() || '';
        finalCity = parts[parts.length - 2]?.trim() || '';
      }
    }
  } else if (deliveryMethod === 'pickup_station') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId)
    );
    finalAddress =
      (selectedQuote && getStationPickupAddressText(selectedQuote)) ||
      selectedQuote?.displayName ||
      'GIGL pickup station';
    finalCity = newAddressCity;
    finalState = newAddressState;
    if ((!finalCity || !finalState) && selectedAddress?.address) {
      const parts = selectedAddress.address.split(',');
      if (parts.length >= 2) {
        finalCity ||= parts[parts.length - 2]?.trim() || '';
        finalState ||= parts[parts.length - 1]?.trim() || '';
      }
    }
  } else if (deliveryMethod === 'pickup') {
    finalAddress = 'Pickup at Store';
    finalCity = 'Lagos';
    finalState = 'Lagos';
  } else if (deliveryMethod === 'airport') {
    finalAddress =
      newAddressStreet ||
      `Airport ${airportType === 'pickup' ? 'Pickup' : 'Delivery'}`;
    finalCity = newAddressCity || 'Airport';
    finalState = newAddressState || 'Nigeria';
  }

  return {
    address: finalAddress,
    city: finalCity,
    state: finalState,
    phone: customerPhone || selectedAddress?.phone || '',
  };
}

// B3 (plan §5 B3): only return a non-null third-party shipping provider
// when delivery is via a quoted carrier (door). Pickup and airport are
// delivery-method labels, not third-party shipping providers — sending
// 'Pickup'/'Airport' as `shipping_provider` would trip the RPC's new
// `shipping_quote_required` guard. Returning null lets the RPC bypass
// the guard for these flows.
//
// B3 review fix (PR #1611): when door + selectedQuoteId is set but the
// id doesn't resolve in the current `shippingQuotes` list (e.g. rates
// expired or got refreshed under us), we MUST NOT fabricate a
// 'Standard' provider — that lets the order submit with a dangling
// quote id and a phony provider, which is the exact data-integrity
// gap B3 closes. Return a discriminated result so the caller can
// surface a validation toast and bail. The inline checkout-page.tsx
// uses the same fail-closed pattern.
type ShippingProviderResolution =
  | { ok: true; provider: string | null }
  | { ok: false; reason: 'dangling_quote' };

export function getShippingProvider(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
  shippingQuotes: ShippingQuote[]
): ShippingProviderResolution {
  if (
    (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') &&
    selectedQuoteId
  ) {
    const quote = shippingQuotes.find(
      (q) => String(q.id) === String(selectedQuoteId)
    );
    if (!quote) {
      return { ok: false, reason: 'dangling_quote' };
    }
    if (deliveryMethod === 'door' && isStationPickupQuote(quote)) {
      return { ok: false, reason: 'dangling_quote' };
    }
    if (deliveryMethod === 'pickup_station' && !isStationPickupQuote(quote)) {
      return { ok: false, reason: 'dangling_quote' };
    }
    return { ok: true, provider: quote.provider || null };
  }
  return { ok: true, provider: null };
}

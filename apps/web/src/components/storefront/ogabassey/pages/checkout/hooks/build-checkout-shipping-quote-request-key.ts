interface QuoteRequestReceiver {
  address: string;
  city: string;
  state: string;
  deliveryPreference: 'door' | 'pickup_station';
  merchantId?: string;
  latitude?: number;
  longitude?: number;
  cartSubtotal: number;
  country: string;
  countryCode: string;
}

interface QuoteRequestItem {
  name: string;
  quantity: number;
  price: number;
  negotiatedPrice?: number;
}

/** Bind quote reuse and visible readiness to the same destination and economics. */
export function buildCheckoutShippingQuoteRequestKey(
  receiver: QuoteRequestReceiver,
  cart: QuoteRequestItem[]
) {
  const address =
    receiver.deliveryPreference === 'pickup_station' && !receiver.address.trim()
      ? [receiver.city.trim(), receiver.state.trim()].filter(Boolean).join(', ')
      : receiver.address;
  return JSON.stringify({
    address: address.trim().toLowerCase(),
    city: receiver.city.trim().toLowerCase(),
    deliveryPreference: receiver.deliveryPreference,
    merchantId: receiver.merchantId ?? null,
    items: cart.map((item) => [
      item.name,
      item.quantity,
      item.negotiatedPrice ?? item.price,
    ]),
    state: receiver.state.trim().toLowerCase(),
    latitude: receiver.latitude,
    longitude: receiver.longitude,
    cartSubtotal: receiver.cartSubtotal,
    country: receiver.country,
    countryCode: receiver.countryCode,
  });
}

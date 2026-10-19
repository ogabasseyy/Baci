interface ResolveAirportShippingAddressParams {
  airportType: 'delivery' | 'pickup';
  manualAddress: string;
  manualCity: string;
  manualState: string;
  savedAddress?: string;
}

interface ResolvedAirportShippingAddress {
  address: string;
  city: string;
  state: string;
}

export function resolveAirportShippingAddress({
  airportType,
  manualAddress,
  manualCity,
  manualState,
  savedAddress,
}: ResolveAirportShippingAddressParams): ResolvedAirportShippingAddress {
  let address = manualAddress;
  let city = manualCity;
  let state = manualState;

  if (!address && savedAddress) {
    address = savedAddress;
    const parts = savedAddress.split(',').map((part) => part.trim());
    if (parts.length >= 2) {
      city ||= parts.at(-2) ?? '';
      state ||= parts.at(-1) ?? '';
    }
  }

  return {
    address:
      address || `Airport ${airportType === 'pickup' ? 'Pickup' : 'Delivery'}`,
    city: city || 'Airport',
    state: state || 'Nigeria',
  };
}

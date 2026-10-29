import { getCountryByCode } from '@/lib/countries';
import type { CheckoutShippingQuotesOptions } from './checkout-shipping-quotes-options';
import { buildQuoteRequestKey } from './checkout-shipping-request-key';

/** Match the loader's request identity before an address change can paint. */
export function currentCheckoutShippingRequestKey(
  options: Pick<
    CheckoutShippingQuotesOptions,
    | 'isHydrated'
    | 'merchantId'
    | 'merchantCountry'
    | 'checkoutCart'
    | 'checkoutCartCatalogSubtotal'
    | 'deliveryCoordinates'
    | 'isNewAddressMode'
    | 'newAddressStreet'
    | 'newAddressCity'
    | 'newAddressState'
    | 'addresses'
    | 'selectedAddressId'
  > & { deliveryPreference: 'door' | 'pickup_station' }
): string {
  if (!options.isHydrated || !options.merchantId) return '';
  let address = options.newAddressStreet;
  let city = options.newAddressCity;
  let state = options.newAddressState;
  if (!options.isNewAddressMode) {
    const saved = options.addresses.find(
      (entry) => entry.id === options.selectedAddressId
    );
    if (!saved) return '';
    const parts = saved.address.split(',').map((part) => part.trim());
    if (parts.length < 2) return '';
    address = saved.address;
    city = parts[parts.length - 2] ?? '';
    state = parts[parts.length - 1] ?? '';
  }
  return buildQuoteRequestKey(
    {
      address,
      city,
      state,
      merchantId: options.merchantId,
      deliveryPreference: options.deliveryPreference,
      latitude: options.deliveryCoordinates?.latitude,
      longitude: options.deliveryCoordinates?.longitude,
      country: getCountryByCode(options.merchantCountry)?.name ?? 'Nigeria',
      countryCode: options.merchantCountry,
      cartSubtotal: options.checkoutCartCatalogSubtotal,
    },
    options.checkoutCart
  );
}

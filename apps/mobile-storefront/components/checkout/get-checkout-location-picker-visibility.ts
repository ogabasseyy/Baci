import { shouldShowCheckoutLocationPickers } from './should-show-checkout-location-pickers';

export function getCheckoutLocationPickerVisibility(
  address: string,
  city: string,
  hasCoordinates: boolean,
  isPickupStation: boolean,
  state: string
): boolean {
  return shouldShowCheckoutLocationPickers({
    address,
    city,
    hasCoordinates,
    isPickupStation,
    state,
  });
}

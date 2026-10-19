interface ShouldShowCheckoutLocationPickersParams {
  address: string;
  city: string;
  hasCoordinates: boolean;
  isPickupStation?: boolean;
  state: string;
}

export function shouldShowCheckoutLocationPickers({
  address,
  city,
  hasCoordinates,
  isPickupStation = false,
  state,
}: ShouldShowCheckoutLocationPickersParams): boolean {
  return Boolean(
    (isPickupStation || address.trim()) &&
      (!hasCoordinates || !city.trim() || !state.trim())
  );
}

/** Pickup choices need a location; door quote loading separately requires a street. */
export function canShowDeliveryMethods(input: {
  isHydrated: boolean;
  isNewAddressMode: boolean;
  selectedAddressId: number | null;
  city: string;
  state: string;
}): boolean {
  return input.isHydrated && (input.isNewAddressMode
    ? Boolean(input.city.trim() && input.state.trim())
    : Boolean(input.selectedAddressId));
}

/** Explain why the delivery step cannot continue. */
export function checkoutDeliveryHint({
  deliveryMethod,
  isLoadingQuotes,
  isNewAddressMode,
  city,
  state,
  addressReady,
  hasDeliveryOptions,
}: {
  deliveryMethod: string | null | undefined;
  isLoadingQuotes: boolean;
  isNewAddressMode: boolean;
  city: string;
  state: string;
  addressReady: boolean;
  hasDeliveryOptions: boolean;
}): string {
  if (deliveryMethod === 'pickup') {
    if (isLoadingQuotes)
      return 'Checking pickup availability before continuing.';
    if (isNewAddressMode && (!city.trim() || !state.trim()))
      return 'Enter your city and state to check pickup availability.';
    return 'Refresh pickup availability to continue.';
  }
  if (!addressReady && deliveryMethod === 'door')
    return 'Enter your street address, city and state for home delivery.';
  if (!addressReady && !hasDeliveryOptions)
    return 'Enter your street address, city and state to see delivery options.';
  return 'Choose an available delivery option above to continue.';
}

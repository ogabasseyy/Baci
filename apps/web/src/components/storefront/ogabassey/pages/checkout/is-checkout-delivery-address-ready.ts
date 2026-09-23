interface CheckoutDeliveryAddress {
  address: string;
  city: string;
  state: string;
  country?: string;
}

/** A city/state estimate must never stand in for the customer's street. */
export function isCheckoutDeliveryAddressReady({
  address,
  city,
  state,
  country,
}: CheckoutDeliveryAddress): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[\s,]+/g, ' ');
  const street = normalize(address);
  if (!street || !city.trim() || !state.trim()) return false;
  const locationOnly = [city, state, country].filter(Boolean).join(', ');
  return (
    street !== normalize(city) &&
    street !== normalize(state) &&
    street !== normalize(`${city}, ${state}`) &&
    street !== normalize(locationOnly)
  );
}

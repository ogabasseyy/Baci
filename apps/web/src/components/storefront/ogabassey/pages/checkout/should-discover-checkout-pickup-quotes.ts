/**
 * Discover merchant/station pickup rates from city/state before the shopper
 * leaves the default `door` method (Lagos hides `pickup_station` until a quote
 * exists).
 */
export function shouldDiscoverCheckoutPickupQuotes(input: {
  isStreetReady: boolean;
  hasCityState: boolean;
}): boolean {
  return input.hasCityState && !input.isStreetReady;
}

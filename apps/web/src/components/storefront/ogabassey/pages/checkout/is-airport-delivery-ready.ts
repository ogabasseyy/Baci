/** A restored provider airport choice cannot fall back to a local flat fee. */
export function isAirportDeliveryReady(requiresQuote: boolean, selectedQuoteMatches: boolean): boolean {
  return !requiresQuote || selectedQuoteMatches;
}

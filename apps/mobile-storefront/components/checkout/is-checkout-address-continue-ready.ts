export function isCheckoutAddressContinueReady({
  hasContactIdentity,
  hasSelectedShippingQuote,
  isCurrentQuoteContext,
  isAddressComplete,
  isLoadingQuotes,
  isPickupStation = false,
  requiresShippingQuote,
}: {
  hasContactIdentity: boolean;
  hasSelectedShippingQuote: boolean;
  isAddressComplete: boolean;
  isCurrentQuoteContext: boolean;
  isLoadingQuotes: boolean;
  isPickupStation?: boolean;
  requiresShippingQuote: boolean;
}): boolean {
  if (!hasContactIdentity) return false;
  if (!isPickupStation && !isAddressComplete) return false;
  if (!requiresShippingQuote) return true;
  return !isLoadingQuotes && isCurrentQuoteContext && hasSelectedShippingQuote;
}

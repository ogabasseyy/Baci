import type { DeliveryMethod, ShippingQuote } from './types';

export function resetDeliveryQuotesForAddressChange({
  setDeliveryMethod,
  setSelectedQuoteId,
  setShippingQuotes,
  clearDeliveryCoordinates,
  preserveDeliveryMethod = false,
}: {
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
  setShippingQuotes: (quotes: ShippingQuote[]) => void;
  clearDeliveryCoordinates?: () => void;
  /** Keep airport/store-pickup when only city/state is known (no street yet). */
  preserveDeliveryMethod?: boolean;
}) {
  clearDeliveryCoordinates?.();
  setShippingQuotes([]);
  setSelectedQuoteId('');
  if (!preserveDeliveryMethod) {
    setDeliveryMethod('door');
  }
}

import type { DeliveryMethod, ShippingQuote } from './types';
import { getSelectedQuoteIdForDeliveryMethod } from './get-selected-quote-id-for-delivery-method';

export function createSelectDeliveryMethod({
  selectedQuoteId,
  setDeliveryMethod,
  setSelectedQuoteId,
  shippingQuotes,
}: {
  selectedQuoteId: string;
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
  shippingQuotes: ShippingQuote[];
}) {
  return (method: DeliveryMethod) => {
    setSelectedQuoteId(
      getSelectedQuoteIdForDeliveryMethod(
        method,
        selectedQuoteId,
        shippingQuotes,
      ),
    );
    setDeliveryMethod(method);
  };
}

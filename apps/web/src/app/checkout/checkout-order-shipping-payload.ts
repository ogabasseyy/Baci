import { parseMerchantRateQuoteId } from '@baci/shared/lib';
import { MERCHANT_PROVIDER_CODE } from '@/lib/shipping/types';
import type { ShippingQuote } from '@/types/shipping-quote';

export interface CheckoutShippingSelectionPayload {
  selected_quote_id: string | null;
  shipping_carrier: string;
  shipping_provider: string | null;
  shipping_rate_id?: string;
  shipping_service_tier: string;
  shipping_session_id: string;
}

/**
 * Converts a displayed shipping quote into the order API's two supported
 * shipping-selection contracts. Carrier quotes reference a persisted quote;
 * merchant-configured rates use a synthetic `mrate_<uuid>` id and must instead
 * pass its bare rate id as `shipping_rate_id`.
 */
export function buildCheckoutShippingSelectionPayload(
  quote: ShippingQuote,
  sessionId: string
): CheckoutShippingSelectionPayload {
  const common = {
    shipping_carrier: quote.carrierName,
    shipping_service_tier: quote.serviceTier,
    shipping_session_id: sessionId,
  };

  if (quote.provider !== MERCHANT_PROVIDER_CODE) {
    return {
      ...common,
      selected_quote_id: quote.id,
      shipping_provider: quote.provider,
    };
  }

  const rateId = parseMerchantRateQuoteId(quote.id);

  if (!rateId) {
    throw new Error(
      'The selected merchant delivery option is invalid. Please refresh shipping options.'
    );
  }

  return {
    ...common,
    selected_quote_id: null,
    shipping_provider: null,
    shipping_rate_id: rateId,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  matchesQuoteDestination,
  type OrderShippingAddressForQuote,
} from './order-quote-destination-address';
import {
  type QuoteCheckoutContext,
  throwOrderQuoteMismatch,
  validateQuoteCheckoutContext,
} from './order-quote-destination-checkout';
import { OrderQuoteDestinationMismatchError } from './order-quote-destination-errors';
import { parseStoredQuoteRequest } from './order-shipment-booking-utils';

export type { OrderShippingAddressForQuote } from './order-quote-destination-address';
export { normalizeAddressForQuoteMatch } from './order-quote-destination-address';
export { OrderQuoteDestinationMismatchError } from './order-quote-destination-errors';

type QuoteDestinationRecord = {
  expires_at?: string | null;
  merchant_id?: string | null;
  price?: number | string | null;
  provider?: string | null;
  provider_rate_id: string | null;
  quote_request: unknown;
};

type CheckoutQuoteLookupResponse = {
  data: QuoteDestinationRecord[] | QuoteDestinationRecord | null;
  error?: { message?: string } | null;
};

async function lookupCheckoutQuote(
  supabase: SupabaseClient,
  selectedQuoteId: string,
  merchantId: string | undefined
): Promise<{
  error?: { message?: string } | null;
  quote: QuoteDestinationRecord | null;
}> {
  if (!merchantId) return { quote: null };

  const { data, error } = (await supabase.rpc('get_checkout_shipping_quote', {
    p_merchant_id: merchantId,
    p_quote_id: selectedQuoteId,
  })) as CheckoutQuoteLookupResponse;
  const quote = Array.isArray(data) ? data[0] : data;

  return { error, quote: quote ?? null };
}

export async function enrichShippingAddressWithQuoteDestination(
  supabase: SupabaseClient,
  selectedQuoteId: string | null | undefined,
  shippingAddress: OrderShippingAddressForQuote | undefined,
  context: QuoteCheckoutContext = {}
): Promise<OrderShippingAddressForQuote | undefined> {
  if (!selectedQuoteId) {
    return shippingAddress;
  }

  const { error: quoteError, quote } = await lookupCheckoutQuote(
    supabase,
    selectedQuoteId,
    context.merchantId
  );
  if (quoteError) {
    throw new OrderQuoteDestinationMismatchError(
      'Unable to validate the saved shipping quote. Please get a new quote before checkout.',
      'INTERNATIONAL_QUOTE_LOOKUP_FAILED',
      500
    );
  }

  if (
    !quote &&
    (context.shippingProvider || context.shippingFee !== undefined)
  ) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_ORDER_MISMATCH');
  }

  const isGiglQuote = quote?.provider === 'GIGL';
  if (!quote || !isGiglQuote) {
    return shippingAddress;
  }

  if (!shippingAddress) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_DESTINATION_MISMATCH');
  }

  const expiresAt = Date.parse(quote.expires_at ?? '');
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_EXPIRED');
  }

  const quoteRequest = parseStoredQuoteRequest(quote.quote_request);
  if (!quoteRequest) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_REQUEST_MISSING');
  }

  if (!matchesQuoteDestination(shippingAddress, quoteRequest)) {
    throw new OrderQuoteDestinationMismatchError();
  }
  validateQuoteCheckoutContext(quote, quoteRequest, context);

  return {
    ...shippingAddress,
    country: quoteRequest.receiver.country ?? shippingAddress.country,
    countryCode:
      quoteRequest.receiver.countryCode ?? shippingAddress.countryCode,
    postalCode: quoteRequest.receiver.postalCode ?? shippingAddress.postalCode,
  };
}

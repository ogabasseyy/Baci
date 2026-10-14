import type { SupabaseClient } from '@supabase/supabase-js';
import { shippingCoordinatePairSchema } from '@/schemas/shipping-coordinate-pair';
import { readCoordinate } from './international-quote-order-guard';
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
import {
  isShippingProviderCode,
  parseStoredQuoteRequest,
} from './order-shipment-booking-utils';

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

/**
 * Returns the merchant-scoped quote's carrier when it is a known provider
 * code, else null. Lets order creation persist the quote-derived provider
 * when a quoted checkout omits the redundant `shipping_provider`, so the
 * stored hash and RPC payload carry the carrier fulfillment requires.
 */
export async function lookupCheckoutQuoteProvider(
  supabase: SupabaseClient,
  selectedQuoteId: string,
  merchantId: string | undefined
): Promise<string | null> {
  const { quote } = await lookupCheckoutQuote(
    supabase,
    selectedQuoteId,
    merchantId
  );
  return quote && isShippingProviderCode(quote.provider)
    ? quote.provider
    : null;
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

  if (!quote) {
    // Cleanup may have removed the quote row before a confirmed retry
    // arrives. Preserve the keyed replay with the caller's address as-is;
    // the order RPC's hash comparison stays authoritative for
    // replay-vs-conflict.
    if (context.isConfirmedReplay) {
      return shippingAddress;
    }
    if (context.shippingProvider || context.shippingFee !== undefined) {
      throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_ORDER_MISMATCH');
    }
    return shippingAddress;
  }

  if (!isShippingProviderCode(quote.provider)) {
    return shippingAddress;
  }

  if (!shippingAddress) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_DESTINATION_MISMATCH');
  }

  const expiresAt = Date.parse(quote.expires_at ?? '');
  // A confirmed same-key retry must reach the order RPC's replay path even
  // after its quote expired. Expiry is the only non-deterministic check here,
  // so skipping it alone reproduces the first attempt's destination and hash;
  // the RPC hash comparison stays authoritative for replay-vs-conflict.
  if (
    !context.isConfirmedReplay &&
    Number.isFinite(expiresAt) &&
    expiresAt <= Date.now()
  ) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_EXPIRED');
  }

  const quoteRequest = parseStoredQuoteRequest(quote.quote_request);
  if (!quoteRequest) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_REQUEST_MISSING');
  }

  if (!matchesQuoteDestination(shippingAddress, quoteRequest)) {
    throw new OrderQuoteDestinationMismatchError();
  }
  validateQuoteCheckoutContext(quote, quoteRequest, {
    ...context,
    // A quoted checkout may omit the redundant provider: the merchant-scoped
    // quote row is authoritative for it. A supplied-but-different provider
    // still fails closed inside the context check.
    shippingProvider: context.shippingProvider ?? quote.provider,
  });

  const orderPin = shippingCoordinatePairSchema.safeParse(shippingAddress);
  // Stored quote receivers are database JSON: pins may be null or numeric
  // strings. Read them with the booking guard's reader so checkout accepts
  // what fulfillment accepts; garbage pins still fail closed below.
  const receiverLatitude = readCoordinate(
    quoteRequest.receiver.latitude,
    -90,
    90
  );
  const receiverLongitude = readCoordinate(
    quoteRequest.receiver.longitude,
    -180,
    180
  );
  if (
    receiverLatitude.status === 'invalid' ||
    receiverLongitude.status === 'invalid'
  ) {
    throw new OrderQuoteDestinationMismatchError();
  }
  const quotePin = shippingCoordinatePairSchema.safeParse({
    ...(receiverLatitude.status === 'valid'
      ? { latitude: receiverLatitude.value }
      : {}),
    ...(receiverLongitude.status === 'valid'
      ? { longitude: receiverLongitude.value }
      : {}),
  });
  if (!orderPin.success || !quotePin.success) {
    throw new OrderQuoteDestinationMismatchError();
  }
  const { latitude: orderLatitude, longitude: orderLongitude } = orderPin.data;
  const { latitude: quoteLatitude, longitude: quoteLongitude } = quotePin.data;
  const orderHasPin =
    typeof orderLatitude === 'number' && typeof orderLongitude === 'number';
  const quoteHasPin =
    typeof quoteLatitude === 'number' && typeof quoteLongitude === 'number';
  // A new checkout can adopt the validated, merchant-scoped quote's pin.
  // Existing orders must keep their own destination provenance; matching text
  // alone does not authorize adding or replacing their coordinates.
  if (
    (orderHasPin && !quoteHasPin) ||
    (!orderHasPin && quoteHasPin && !context.isNewOrder) ||
    (orderHasPin &&
      quoteHasPin &&
      (Math.abs(orderLatitude - quoteLatitude) > 1e-6 ||
        Math.abs(orderLongitude - quoteLongitude) > 1e-6))
  ) {
    throw new OrderQuoteDestinationMismatchError();
  }

  return {
    ...shippingAddress,
    ...(!orderHasPin && quoteHasPin ? quotePin.data : {}),
    country: quoteRequest.receiver.country ?? shippingAddress.country,
    countryCode:
      quoteRequest.receiver.countryCode ?? shippingAddress.countryCode,
    postalCode: quoteRequest.receiver.postalCode ?? shippingAddress.postalCode,
  };
}

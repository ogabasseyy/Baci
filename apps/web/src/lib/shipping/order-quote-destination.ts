import type { SupabaseClient } from '@supabase/supabase-js';
import { shippingCoordinatePairSchema } from '@/schemas/shipping-coordinate-pair';
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
import { readCoordinate } from './read-coordinate';

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

type AttestedCoordinates = { latitude?: number; longitude?: number };

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
  context: QuoteCheckoutContext = {},
  options: { persistAttestedCoordinates?: boolean } = {}
): Promise<(OrderShippingAddressForQuote & AttestedCoordinates) | undefined> {
  if (!selectedQuoteId) {
    context.onValidatedQuoteProvider?.(null);
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
      context.onValidatedQuoteProvider?.(null);
      return shippingAddress;
    }
    if (context.shippingProvider || context.shippingFee !== undefined) {
      throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_ORDER_MISMATCH');
    }
    context.onValidatedQuoteProvider?.(null);
    return shippingAddress;
  }

  if (!isShippingProviderCode(quote.provider)) {
    context.onValidatedQuoteProvider?.(null);
    return shippingAddress;
  }

  if (!shippingAddress) {
    throwOrderQuoteMismatch('INTERNATIONAL_QUOTE_DESTINATION_MISMATCH');
  }

  const expiresAt = Date.parse(quote.expires_at ?? '');
  // Confirmed same-key retries skip expiry and catalog-derived item matching:
  // those inputs can change after creation. Destination/pin, merchant, provider
  // and fee checks still run; the RPC's stored hash enforces the caller's
  // product, quantity and price instead of rewriting the existing order.
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
  // alone does not authorize adding or replacing their coordinates. Callers
  // that never opted into adoption (isNewOrder undefined, no attested
  // opt-in) simply keep their address unpinned.
  if (
    (orderHasPin && !quoteHasPin) ||
    (!orderHasPin && quoteHasPin && context.isNewOrder === false) ||
    (orderHasPin &&
      quoteHasPin &&
      (Math.abs(orderLatitude - quoteLatitude) > 1e-6 ||
        Math.abs(orderLongitude - quoteLongitude) > 1e-6))
  ) {
    throw new OrderQuoteDestinationMismatchError();
  }

  context.onValidatedQuoteProvider?.(quote.provider);
  return {
    ...shippingAddress,
    ...(!orderHasPin &&
    quoteHasPin &&
    (context.isNewOrder || options.persistAttestedCoordinates)
      ? quotePin.data
      : {}),
    // Only new-order creation opts in. Existing paid orders must use explicit
    // destination-confirmation recovery, never implicit booking-time repair.
    // Persist the coerced quote pin: stored receivers may carry numeric
    // strings, which readCoordinate already normalized into quotePin.
    ...(options.persistAttestedCoordinates && quoteHasPin ? quotePin.data : {}),
    country: quoteRequest.receiver.country ?? shippingAddress.country,
    countryCode:
      quoteRequest.receiver.countryCode ?? shippingAddress.countryCode,
    postalCode: quoteRequest.receiver.postalCode ?? shippingAddress.postalCode,
  };
}

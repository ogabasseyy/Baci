import type { SupabaseClient } from '@supabase/supabase-js';
import { isEligibleAirportQuote } from '@/lib/checkout/airport-delivery-quote-validation';
import { isConfirmedLocalAirportReplay } from '@/lib/checkout/is-confirmed-local-airport-replay';
import { LocalAirportDeliveryFeeMismatchError } from '@/lib/checkout/local-airport-delivery-fee-mismatch-error';
import { LocalAirportDeliveryValidationError } from '@/lib/checkout/local-airport-delivery-validation-error';
import { readAirportQuote } from '@/lib/checkout/read-airport-delivery-quote';
import { logger } from '@/lib/logger';

interface ValidateSelectedAirportQuoteInput {
  merchantId: string;
  requestIdempotencyKey?: string | null;
  selectedQuoteId?: string | null;
  shippingFee: number;
  shippingProvider?: string | null;
  supabase: SupabaseClient;
}

/** Validate a selected GoFaster quote and permit only confirmed replays. */
export async function validateSelectedAirportQuote({
  merchantId,
  requestIdempotencyKey,
  selectedQuoteId,
  shippingFee,
  shippingProvider,
  supabase,
}: ValidateSelectedAirportQuoteInput): Promise<boolean> {
  if (!selectedQuoteId) return false;

  const { data, error } = await supabase.rpc('get_checkout_shipping_quote', {
    p_merchant_id: merchantId,
    p_quote_id: selectedQuoteId,
  });
  if (error) {
    logger.error({
      message: 'Unable to validate selected airport shipping quote',
      merchantId,
      selectedQuoteId,
      error,
    });
    throw new LocalAirportDeliveryValidationError(
      'Unable to validate the selected airport delivery quote',
      'AIRPORT_QUOTE_LOOKUP_FAILED',
      500
    );
  }

  const isReplay = () =>
    isConfirmedLocalAirportReplay({
      merchantId,
      requestIdempotencyKey,
      supabase,
    });
  const quote = readAirportQuote(data);
  if (!quote && (await isReplay())) return true;
  if (!quote || !isEligibleAirportQuote(quote, shippingProvider)) {
    throw new LocalAirportDeliveryValidationError(
      'The selected airport delivery quote is not eligible for airport delivery',
      'AIRPORT_QUOTE_INVALID',
      400
    );
  }

  const expiresAt =
    typeof quote.expires_at === 'string'
      ? Date.parse(quote.expires_at)
      : Number.NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    const isIdempotentReplay = await isReplay();
    if (isIdempotentReplay) return true;

    throw new LocalAirportDeliveryValidationError(
      'The selected airport delivery quote has expired',
      'AIRPORT_QUOTE_EXPIRED',
      400
    );
  }

  const quotePrice = Number(quote.price);
  if (
    Number.isFinite(quotePrice) &&
    Math.abs(shippingFee - quotePrice) > 0.01
  ) {
    const isIdempotentReplay = await isReplay();
    if (isIdempotentReplay) return true;

    throw new LocalAirportDeliveryFeeMismatchError(shippingFee, quotePrice);
  }

  return false;
}

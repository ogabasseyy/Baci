import type { SupabaseClient } from '@supabase/supabase-js';
import { isEligibleAirportQuote } from '@/lib/checkout/airport-delivery-quote-validation';
import { LocalAirportDeliveryValidationError } from '@/lib/checkout/local-airport-delivery-validation-error';
import { readAirportQuote } from '@/lib/checkout/read-airport-delivery-quote';
import { logger } from '@/lib/logger';

interface IsSelectedAirportQuoteInput {
  merchantId: string;
  selectedQuoteId?: string | null;
  supabase: SupabaseClient;
}

/** Classify a stored quote without trusting a caller-supplied delivery method. */
export async function isSelectedAirportQuote({
  merchantId,
  selectedQuoteId,
  supabase,
}: IsSelectedAirportQuoteInput): Promise<boolean> {
  if (!selectedQuoteId) return false;

  const { data, error } = await supabase.rpc('get_checkout_shipping_quote', {
    p_merchant_id: merchantId,
    p_quote_id: selectedQuoteId,
  });
  if (error) {
    logger.error({
      message: 'Unable to classify selected shipping quote',
      merchantId,
      selectedQuoteId,
      error,
    });
    throw new LocalAirportDeliveryValidationError(
      'Unable to validate the selected shipping quote',
      'AIRPORT_QUOTE_LOOKUP_FAILED',
      500
    );
  }

  const quote = readAirportQuote(data);
  const quoteProvider =
    typeof quote?.provider === 'string' ? quote.provider : null;
  return Boolean(quote && isEligibleAirportQuote(quote, quoteProvider));
}

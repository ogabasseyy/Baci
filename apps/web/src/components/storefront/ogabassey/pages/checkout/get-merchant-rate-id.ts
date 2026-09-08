import { MERCHANT_RATE_ID_PREFIX } from '@/lib/shipping/merchant-rates/to-shipping-quotes';

/**
 * Extract the bare `merchant_shipping_rates.id` from a selected quote id, or
 * `null` when the selection is a carrier quote. The order POST sends this as
 * `shipping_rate_id` (and forces the null shipping_provider/selected_quote_id
 * path) so the server recomputes the fee from rate config.
 */
export function getMerchantRateId(quoteId: string): string | null {
  return quoteId.startsWith(MERCHANT_RATE_ID_PREFIX)
    ? quoteId.slice(MERCHANT_RATE_ID_PREFIX.length) || null
    : null;
}

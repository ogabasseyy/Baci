import { MERCHANT_PROVIDER_CODE } from '@/lib/shipping/types';
import type { ShippingQuote } from './types';

/**
 * Merchant-configured rate quotes surface with `provider === 'MERCHANT'` and a
 * `mrate_<uuid>` id. These helpers let the checkout UI treat them
 * provider-agnostically while the order POST recovers the bare rate id.
 */
export function isMerchantQuote(quote: ShippingQuote): boolean {
  return quote.provider === MERCHANT_PROVIDER_CODE;
}

import { createPublicClient } from '@/lib/supabase/public';
import {
  getMerchantRateQuotes,
  type MerchantRateQuoteInput,
  type MerchantRateQuoteResult,
} from './merchant-rate-quotes';

/** Merchant rate discovery always uses the anonymous-safe storefront client. */
export function loadPublicMerchantRates(
  merchantId: string | undefined,
  input: Omit<MerchantRateQuoteInput, 'merchantId'>
): Promise<MerchantRateQuoteResult> {
  if (!merchantId) return Promise.resolve({ quotes: [] });
  return getMerchantRateQuotes(
    createPublicClient({ clientInfo: 'baci-public-shipping-rates' }),
    { merchantId, ...input }
  );
}

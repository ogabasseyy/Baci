import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

/**
 * Whether a fixed loyalty code's issuance currency (stamped at mint)
 * still matches the merchant's currently resolved currency. A failed
 * or empty merchant lookup counts as current: this is a preview gate,
 * and the order wrapper enforces the same check authoritatively.
 */
export async function isLoyaltyCodeCurrencyCurrent(
  supabase: SupabaseClient,
  merchantId: string,
  issuanceCurrency: string
): Promise<boolean> {
  const { data: merchantRow, error } = await supabase
    .from('merchants')
    .select('country, payout_currency')
    .eq('id', merchantId)
    .maybeSingle();
  if (error || !merchantRow) return true;
  return (
    resolveMerchantCurrencyConfig({
      country: merchantRow.country ?? null,
      payout_currency: merchantRow.payout_currency ?? null,
    }).code === issuanceCurrency.toUpperCase()
  );
}

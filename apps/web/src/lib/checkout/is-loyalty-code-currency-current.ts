import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether a fixed loyalty code's issuance currency (stamped at mint)
 * still matches the currency a new order would be stamped with: the
 * order RPC's rule (a non-blank payout currency uppercased, else NGN),
 * NOT the display resolver's country fallback — the wrapper compares
 * the stamp against the order's currency, so the preview must too. A
 * failed or empty merchant lookup counts as current: this is a preview
 * gate, and the order wrapper enforces the same check authoritatively.
 */
export async function isLoyaltyCodeCurrencyCurrent(
  supabase: SupabaseClient,
  merchantId: string,
  issuanceCurrency: string
): Promise<boolean> {
  const { data: merchantRow, error } = await supabase
    .from('merchants')
    .select('payout_currency')
    .eq('id', merchantId)
    .maybeSingle();
  if (error || !merchantRow) return true;
  const payout = (merchantRow.payout_currency ?? '').trim().toUpperCase();
  const orderCurrency = payout === '' ? 'NGN' : payout;
  return orderCurrency === issuanceCurrency.toUpperCase();
}

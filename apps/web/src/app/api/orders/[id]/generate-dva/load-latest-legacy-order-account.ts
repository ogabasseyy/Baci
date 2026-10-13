import type { SupabaseClient } from '@supabase/supabase-js';

/** Loads the legacy non-Paystack account retained for older order flows. */
export function loadLatestLegacyOrderAccount(
  supabase: SupabaseClient,
  orderId: string
) {
  return supabase
    .from('order_payment_accounts')
    .select(
      'account_number, bank_name, account_name, provider, created_at, assigned_at, expires_at'
    )
    .eq('order_id', orderId)
    .neq('provider', 'paystack')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

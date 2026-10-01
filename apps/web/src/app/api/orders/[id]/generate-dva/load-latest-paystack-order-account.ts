import type { SupabaseClient } from '@supabase/supabase-js';

/** Loads the newest Paystack assignment so active and historical aliases can be distinguished. */
export function loadLatestPaystackOrderAccount(
  supabase: SupabaseClient,
  orderId: string
) {
  return supabase
    .from('order_payment_accounts')
    .select(
      'account_number, bank_name, account_name, provider, assignment_customer_email_source, created_at, assigned_at, expires_at'
    )
    .eq('order_id', orderId)
    .eq('provider', 'paystack')
    .order('assigned_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

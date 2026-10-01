import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dates a paid receipt from its completing payment. Later payments land in
 * the transactions ledger without touching the order's transaction date, so
 * the newest completed payment wins; null falls back to the order dates.
 */
export async function resolveManualDocumentReceiptDate(
  supabase: SupabaseClient,
  orderId: string,
  isPaid: boolean
): Promise<string | null> {
  if (!isPaid) return null;
  const paymentTransaction = await supabase
    .from('transactions')
    .select('created_at')
    .eq('order_id', orderId)
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return paymentTransaction?.data?.created_at &&
    !paymentTransaction.error &&
    typeof paymentTransaction.data.created_at === 'string'
    ? paymentTransaction.data.created_at
    : null;
}

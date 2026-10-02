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
    // Paystack-backed payments settle as 'success', manual ones as
    // 'completed': the DVA reservation paths treat both as settled.
    .in('status', ['completed', 'success'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // A failed lookup must retry through the outbox path, not silently fall
  // back to the order dates: a sent receipt is terminal, so swallowing the
  // error here would permanently mis-date a financial document.
  if (paymentTransaction.error)
    throw new Error('Manual document receipt date unavailable');
  return paymentTransaction?.data?.created_at &&
    typeof paymentTransaction.data.created_at === 'string'
    ? paymentTransaction.data.created_at
    : null;
}

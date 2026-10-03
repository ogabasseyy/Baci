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
    // Nulls sort first on descending order: a null-created payment would
    // shadow the newest dated one and mis-date the receipt.
    .order('created_at', { ascending: false, nullsFirst: false })
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

interface ReceiptCompletionCandidate {
  created_at?: string | null;
  status?: string | null;
  transaction_type?: string | null;
}

/**
 * In-memory twin of the lookup above for callers that already hold the
 * customer-visible transaction rows (the customer client cannot read the
 * merchant-only ledger directly). Same semantics: settled payment rows
 * only, newest first, null timestamps last.
 */
export function selectReceiptCompletionDate(
  rows: readonly ReceiptCompletionCandidate[]
): string | null {
  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.transaction_type !== 'payment') continue;
    if (row.status !== 'completed' && row.status !== 'success') continue;
    if (typeof row.created_at !== 'string') continue;
    const time = Date.parse(row.created_at);
    if (!Number.isFinite(time)) continue;
    if (time > newestTime) {
      newestTime = time;
      newest = row.created_at;
    }
  }
  return newest;
}

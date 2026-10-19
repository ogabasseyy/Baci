import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { Transaction } from './dashboard-transaction';

/**
 * Fetch an order's ledger rows for the dashboard refund section
 * (transaction_type lets it tell funded pending orders from
 * unfunded ones). Merchant-scoped; RLS is not the only tenant
 * boundary relied upon. Fails open on visibility: an empty list
 * would hide the refund recovery panel exactly when it may be
 * needed, so errors leave funding unknown (undefined) and log
 * for operators.
 */
export async function fetchOrderTransactions({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  supabase: SupabaseClient;
}): Promise<Transaction[] | undefined> {
  const { data: transactions, error: transactionsError } = await supabase
    .from('transactions')
    .select(
      'id, gateway_reference, transaction_type, status, amount, currency, gateway, created_at'
    )
    .eq('merchant_id', merchantId)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });

  if (transactionsError) {
    logger.error({
      message: 'Error fetching order transactions',
      error: transactionsError,
      merchantId,
      orderId,
      route: 'dashboard/orders/getOrder',
    });
    return undefined;
  }

  return (transactions || []) as Transaction[];
}

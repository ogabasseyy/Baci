import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Confirm an attempt is superseded by a different funded payment on an
 * already paid order before verification runs. Other pending attempts
 * still need payment recovery, so they hold instead of proceeding. A
 * completed retry only needs the order to exist: it was captured while
 * paid, and a later refund must not strand its review. A partially paid
 * order proceeds without another payment row: its balance may be wallet
 * or savings value with no transaction leg, and the partial-capture
 * gate downstream is designed for exactly that remaining-balance
 * attempt — requiring another row would rotate it forever while it
 * keeps blocking merchant cancellation. Returns whether the caller
 * proceeds; held attempts are already recorded on the hold.
 */
export async function guardAbandonedPaystackAttempt({
  attempt,
  hold,
  isCompletedRetry,
  summary,
  supabase,
}: {
  attempt: {
    id: string;
    merchant_id: string;
    order_id: string;
  };
  hold: (reason: string) => Promise<void>;
  isCompletedRetry: boolean;
  summary: { failed: boolean };
  supabase: SupabaseClient;
}): Promise<'proceed' | 'held'> {
  // Only clear attempts superseded by a different funded payment on an
  // already paid order. Other pending attempts still need payment recovery.
  const orderQuery = supabase
    .from('orders')
    .select('id, payment_status')
    .eq('id', attempt.order_id)
    .eq('merchant_id', attempt.merchant_id);
  if (!isCompletedRetry) {
    orderQuery.in('payment_status', ['paid', 'partially_paid']);
  }
  const { data: order, error: orderError } = await orderQuery.maybeSingle();
  if (orderError || !order) {
    if (orderError) summary.failed = true;
    await hold('order_not_paid_or_unavailable');
    return 'held';
  }
  if (
    !isCompletedRetry &&
    (order as { payment_status?: string }).payment_status === 'partially_paid'
  ) {
    // The validated partial balance is sufficient: wallet/savings value
    // leaves no payment transaction for the funded-leg lookup below,
    // and the partial-capture gate handles the remaining-balance
    // attempt once verification reports.
    return 'proceed';
  }
  // A funded leg in a refund state supersedes like a completed one: the
  // cancellation flow refunds refund_pending/refunded legs, but
  // cancel_order_as_merchant still rejects the order while this stale
  // attempt stays pending — and a completed-only lookup would rotate
  // it as unresolvable forever, so the merchant could never cancel
  // even when provider verification would clear it.
  const { data: completed, error: completedError } = await supabase
    .from('transactions')
    .select('id')
    .eq('order_id', attempt.order_id)
    .eq('merchant_id', attempt.merchant_id)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending', 'refunded'])
    .neq('id', attempt.id)
    .limit(1);
  if (completedError || !completed?.length) {
    if (completedError) summary.failed = true;
    await hold('no_completed_payment_or_unavailable');
    return 'held';
  }
  return 'proceed';
}

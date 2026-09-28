import type { SupabaseClient } from '@supabase/supabase-js';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';

/**
 * Complete a verified capture on a partially paid order through the atomic
 * order finalizer, which distinguishes the legitimate remaining payment
 * from an overpayment. Mismatched captures never reach this path: they
 * are filed with their evidence instead.
 */
export async function finalizePartiallyPaidAbandonedAttempt({
  attempt,
  finalizePayment,
  hold,
  providerData,
  scheduleAfter,
  summary,
  supabase,
}: {
  attempt: {
    amount: number;
    gateway_reference: string;
    id: string;
    merchant_id: string;
    order_id: string;
    platform_fee: number | null;
    status: 'pending' | 'processing';
  };
  finalizePayment: typeof finalizeOrderGatewayPayment;
  hold: (reason: string) => Promise<void>;
  providerData: Record<string, unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  summary: { completed: string[]; failed: boolean; reviewsFiled: string[] };
  supabase: SupabaseClient;
}): Promise<void> {
  if (attempt.status === 'processing') {
    // The completion RPC admits only pending/completed rows, so atomically
    // normalize a wedged processing row to pending first. Zero matched rows
    // means a concurrent webhook completed it meanwhile — a genuine
    // concurrent change, not a wedged row.
    const { data: admitted, error: admitError } = await supabase
      .from('transactions')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', attempt.id)
      .eq('order_id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .eq('transaction_type', 'payment')
      .eq('gateway', 'paystack')
      .eq('gateway_reference', attempt.gateway_reference)
      .eq('status', 'processing')
      .select('id');
    if (admitError) summary.failed = true;
    if (admitError || admitted?.length !== 1) {
      await hold('changed_concurrently');
      return;
    }
  }
  const outcome = await finalizePayment({
    actor: 'cron:reconcile-gateway-paid-orders',
    gateway: 'paystack',
    gatewayResponse: providerData,
    orderId: attempt.order_id,
    reference: attempt.gateway_reference,
    scheduleAfter,
    supabase,
    transaction: {
      amount: attempt.amount,
      gateway_reference: attempt.gateway_reference,
      id: attempt.id,
      merchant_id: attempt.merchant_id,
      order_id: attempt.order_id,
      platform_fee: attempt.platform_fee,
    },
    // The cron never claims the flip: a concurrent webhook may complete
    // this row first, so classification must come from the completion
    // RPC result (order_updated/already_completed) rather than the
    // stale candidate snapshot. Passing true would misclassify such a
    // replay as a new capture on an already-paid order.
    wonTransactionFlip: false,
  });
  if (outcome.kind === 'completed') {
    summary.completed.push(attempt.id);
    return;
  }
  if (outcome.kind === 'order_cancelled' || outcome.kind === 'order_skipped') {
    summary.reviewsFiled.push(attempt.id);
    return;
  }
  if (
    outcome.kind === 'completion_failed' &&
    typeof outcome.error === 'object' &&
    outcome.error !== null &&
    (outcome.error as { error_code?: unknown }).error_code ===
      'TRANSACTION_IN_UNEXPECTED_STATE'
  ) {
    await hold('changed_concurrently');
    return;
  }
  summary.failed = true;
  await hold(outcome.kind);
}

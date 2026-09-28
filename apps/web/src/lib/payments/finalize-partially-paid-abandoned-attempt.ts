import type { SupabaseClient } from '@supabase/supabase-js';
import { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';

/**
 * Complete a verified capture on a partially paid order through the atomic
 * order finalizer, which distinguishes the legitimate remaining payment
 * from an overpayment. Mismatched captures never reach this path: they
 * are filed with their evidence instead.
 */
export async function finalizePartiallyPaidAbandonedAttempt({
  attempt,
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
  };
  hold: (reason: string) => Promise<void>;
  providerData: Record<string, unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  summary: { completed: string[]; failed: boolean; reviewsFiled: string[] };
  supabase: SupabaseClient;
}): Promise<void> {
  const outcome = await finalizeOrderGatewayPayment({
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

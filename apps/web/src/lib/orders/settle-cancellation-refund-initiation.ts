import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from '@/lib/orders/initiate-paystack-cancellation-refunds';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineWithheldCancellationRefundLegs } from '@/lib/orders/quarantine-withheld-cancellation-refund-legs';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import {
  DeferredError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';

/**
 * Settle a preflighted refund run: initiate clean legs, quarantine
 * withheld ones, and defer under pending manuals. Provider-verified
 * manual legs skip the withheld quarantine (their proof is stamped)
 * but still defer: the stamp changed the matcher's inputs, so the
 * next run re-derives coverage instead of this run reasoning about
 * it — and a partially covered verified leg keeps the same
 * manual-pending liveness as any other partial manual.
 */
export async function settleCancellationRefundInitiation({
  auditBlockedTransactions,
  deadlineMs,
  initiationTransactions,
  isLastAttempt,
  manualPendingLegIds,
  mismatchedTransactions,
  order,
  reason,
  refundedPaymentIds,
  step,
  supabase,
  verifiedManualPaystackLegIds,
}: {
  auditBlockedTransactions: GatewayPaymentTransaction[];
  deadlineMs?: number;
  initiationTransactions: GatewayPaymentTransaction[];
  isLastAttempt?: boolean;
  manualPendingLegIds: Set<string>;
  mismatchedTransactions: GatewayPaymentTransaction[];
  order: CancellationOrder;
  reason?: string;
  refundedPaymentIds: Set<string>;
  step: OrderCancellationSideEffectStep;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  verifiedManualPaystackLegIds: string[];
}): Promise<{ refundIds: number[] }> {
  const verifiedLegIds = new Set(verifiedManualPaystackLegIds);
  const refundIds = await initiatePaystackCancellationRefunds({
    deadlineMs,
    isLastAttempt,
    order,
    reason,
    refundedPaymentIds,
    supabase,
    transactions: initiationTransactions,
  });
  await quarantineWithheldCancellationRefundLegs({
    auditBlockedTransactions,
    mismatchedTransactions: mismatchedTransactions.filter(
      (transaction) => !verifiedLegIds.has(transaction.id)
    ),
    order,
    supabase,
  });
  if (manualPendingLegIds.size > 0 || verifiedLegIds.size > 0) {
    // Never complete under a pending manual: the final record would
    // land on a completed row no drain reselects, stranding finalization.
    await tryResetCancellationSideEffectAttempts(supabase, order.id, step);
    throw new DeferredError('cancellation_refund_awaiting_manual_completion');
  }
  return { refundIds };
}

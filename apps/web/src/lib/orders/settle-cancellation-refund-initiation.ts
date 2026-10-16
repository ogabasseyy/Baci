import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from '@/lib/orders/initiate-paystack-cancellation-refunds';
import { normalizeRefundMoneyField } from '@/lib/orders/normalize-refund-money-field';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
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
  budgetDeferred,
  budgetSkippedManualLegIds,
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
  budgetDeferred?: boolean;
  budgetSkippedManualLegIds?: string[];
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
  // Budget-skipped manual legs are unverified, not mismatched: their
  // claims resume next run, so quarantining them now would
  // permanently strand legitimate claims behind delivery_uncertain.
  const skippedLegIds = new Set(budgetSkippedManualLegIds ?? []);
  // Order-side currency for the gates below (legs keep strict
  // matching; see the settled-leg gate).
  const orderCurrency = normalizeRefundMoneyField(order.currency) || 'NGN';
  const refundIds = await initiatePaystackCancellationRefunds({
    deadlineMs,
    isLastAttempt,
    order,
    reason,
    refundedPaymentIds,
    supabase,
    transactions: initiationTransactions,
  });
  // Unresolved mismatched legs, shared by the withheld quarantine
  // and the settled-leg currency gate below: foreign legs belong to
  // the currency gate (it names the specific cause after clean
  // initiation), so the withheld call only takes currency-matching
  // legs and the generic error cannot shadow it.
  const pendingMismatched = mismatchedTransactions.filter(
    (transaction) =>
      !verifiedLegIds.has(transaction.id) && !skippedLegIds.has(transaction.id)
  );
  await quarantineWithheldCancellationRefundLegs({
    auditBlockedTransactions,
    mismatchedTransactions: pendingMismatched.filter(
      (transaction) =>
        normalizeRefundMoneyField(transaction.currency) === orderCurrency
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
  if (budgetDeferred === true) {
    // A budget-short run initiated its verified prefix above:
    // reselect for the unverified remainder instead of completing
    // with legs outstanding. The reset keeps the resume on a fresh
    // budget; initiated refunds persist, so every resume converges.
    await tryResetCancellationSideEffectAttempts(supabase, order.id, step);
    throw new DeferredError(
      'cancellation_refund_preflight_deferred_for_budget'
    );
  }
  // Settled legs never passed the initiation-time currency gate (it
  // scopes to outstanding legs so a settled leg cannot strand its
  // siblings), but the shared legs-covered gate and the manager
  // reject foreign-currency terminal rows as anomalous: completing
  // here would finalize the side effect while the order can never
  // finalize, with no reclaimable row. Quarantine after clean
  // initiation instead of completing silently. Manual and budget
  // deferrals above take precedence: the resumed run reaches this
  // branch once nothing else is outstanding.
  const foreignSettledLegs = [
    ...initiationTransactions,
    ...pendingMismatched,
  ].filter(
    (transaction) =>
      refundedPaymentIds.has(transaction.id) &&
      (!normalizeRefundMoneyField(transaction.currency) ||
        normalizeRefundMoneyField(transaction.currency) !== orderCurrency)
  );
  if (foreignSettledLegs.length > 0) {
    await quarantineRefund({
      order,
      reason: 'Payment currency requires review before refund',
      supabase,
      transactions: foreignSettledLegs,
    });
  }
  return { refundIds };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeCustomerEmailCancellationSideEffect } from '@/lib/orders/execute-customer-email-cancellation-side-effect';
import { fetchAuditBlockedCancellationLegIds } from '@/lib/orders/fetch-audit-blocked-cancellation-legs';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import type {
  CancellationEmailSender,
  CancellationMerchant,
  CancellationOrder,
} from '@/lib/orders/order-cancellation-side-effect-types';
import { preflightCancellationRefundCoverage } from '@/lib/orders/preflight-cancellation-refund-coverage';
import { preflightCancellationRefundInitiation } from '@/lib/orders/preflight-cancellation-refund-initiation';
import { probeRefundedLegManualPending } from '@/lib/orders/probe-refunded-leg-manual-pending';
import { quarantineInternalOnlyManualPaystack } from '@/lib/orders/quarantine-internal-only-manual-paystack';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import {
  DeferredError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';
import { settleCancellationRefundInitiation } from '@/lib/orders/settle-cancellation-refund-initiation';
import { soleCompletedCancellationLeg } from '@/lib/orders/sole-completed-cancellation-leg';

export async function executeOrderCancellationSideEffect({
  deadlineMs,
  isLastAttempt,
  merchant,
  order,
  reason,
  sendCancellationEmail,
  step,
  supabase,
}: {
  deadlineMs?: number;
  isLastAttempt?: boolean;
  merchant: CancellationMerchant;
  order: CancellationOrder;
  reason?: string;
  sendCancellationEmail?: CancellationEmailSender;
  step: OrderCancellationSideEffectStep;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<{ messageId: string | null } | { refundIds: number[] }> {
  if (step === 'customer_email') {
    return executeCustomerEmailCancellationSideEffect({
      deadlineMs,
      merchant,
      order,
      reason,
      sendCancellationEmail,
    });
  }

  // Mirror the completion gate's funded-leg statuses: refund-state legs
  // (e.g. PayPal flips the payment row itself while its provider refund
  // is pending) must stay visible so they quarantine or defer instead of
  // slipping to false completion. Self-terminal refunded legs load too
  // so the empty-actionable case below can tell them from a corrupt
  // order with no payment evidence at all.
  const { data: transactionRows, error: transactionError } = await supabase
    .from('transactions')
    .select('id, amount, currency, gateway, gateway_reference, status')
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending', 'refunded'])
    .order('created_at', { ascending: true });
  if (transactionError || !transactionRows?.length) {
    throw new Error('No completed payment transaction found');
  }
  // Link validity spans every funded leg: a terminal refund row linked
  // to a refunded leg is legitimate evidence, not an outside-order link.
  const linkLegs = transactionRows as GatewayPaymentTransaction[];
  const actionableLegs = transactionRows.filter(
    (row) => row.status !== 'refunded'
  );
  const allLegs = actionableLegs as GatewayPaymentTransaction[];
  // Only external legs initiate provider refunds or verify listings.
  const transactions = allLegs.filter((t) =>
    isExternalPaymentGateway(t.gateway)
  );
  const soleCompletedLeg = soleCompletedCancellationLeg(transactions);
  // Refunded-leg probe; merges into the settle deferral below.
  const refundedManualPendingLegIds = await probeRefundedLegManualPending({
    actionableLegCount: actionableLegs.length,
    linkLegs,
    order,
    soleCompletedLegId: soleCompletedLeg?.id ?? null,
    supabase,
  });
  if (actionableLegs.length === 0) {
    // Every leg self-terminalized and anomaly-free: defer for claim.
    await tryResetCancellationSideEffectAttempts(supabase, order.id, step);
    throw new DeferredError('cancellation_refund_awaiting_provider_completion');
  }
  const { data: refundRows, error: refundLookupError } = await supabase
    .from('transactions')
    .select(
      'id, gateway_reference, metadata, status, amount, currency, gateway'
    )
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'refund')
    .order('created_at', { ascending: true });
  if (refundLookupError) {
    throw new Error('Unable to verify existing cancellation refunds');
  }
  if (!transactions.length) {
    await quarantineInternalOnlyManualPaystack({
      allLegs,
      order,
      refundRows: refundRows ?? [],
      supabase,
    });
  }
  const auditBlockedLegIds = await fetchAuditBlockedCancellationLegIds({
    order,
    supabase,
    transactions,
  });
  // Coverage classification plus the quarantine/deferral preflight
  // (invalid links, unlinked rows, unsupported legs, bad amounts,
  // non-terminal rows, in-flight legs). May throw DeferredError when
  // every remaining leg awaits provider completion.
  const {
    linkedPaymentId,
    manualLinkedLegIds,
    manualPendingLegIds,
    mismatchedIds,
    mismatchedTransactions,
    refundedPaymentIds,
  } = await preflightCancellationRefundCoverage({
    allLegs,
    linkLegs,
    order,
    refundRows: refundRows ?? [],
    soleCompletedLeg,
    step,
    supabase,
    transactions,
  });
  // Withhold mismatched legs from initiation: their completed rows do not
  // cover them in matching money, so a full-leg provider refund now would
  // double-refund the covered portion. Audit-blocked legs withhold the
  // same way: their provider refund may already exist. Clean legs still
  // move below. Fully refunded legs need no quarantine: nothing will be
  // initiated for them, so terminalizing would only strand the rest.
  const {
    auditBlockedTransactions,
    budgetDeferred,
    budgetSkippedManualLegIds,
    initiationTransactions,
    verifiedManualPaystackLegIds,
  } = await preflightCancellationRefundInitiation({
    auditBlockedLegIds,
    deadlineMs,
    linkedPaymentId,
    manualLinkedLegIds,
    mismatchedIds,
    order,
    refundedPaymentIds,
    refundRows,
    supabase,
    transactions,
  });
  return settleCancellationRefundInitiation({
    auditBlockedTransactions,
    budgetDeferred,
    budgetSkippedManualLegIds,
    deadlineMs,
    initiationTransactions,
    isLastAttempt,
    manualPendingLegIds: new Set([
      ...manualPendingLegIds,
      ...refundedManualPendingLegIds,
    ]),
    mismatchedTransactions,
    order,
    reason,
    refundedPaymentIds,
    step,
    supabase,
    verifiedManualPaystackLegIds,
  });
}

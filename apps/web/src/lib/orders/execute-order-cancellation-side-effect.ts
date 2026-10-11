import type { SupabaseClient } from '@supabase/supabase-js';
import { assertExternalCancellationRefundableAmount } from '@/lib/orders/assert-external-cancellation-refundable-amount';
import { classifyCancellationRefundLinks } from '@/lib/orders/classify-cancellation-refund-links';
import { executeCustomerEmailCancellationSideEffect } from '@/lib/orders/execute-customer-email-cancellation-side-effect';
import { fetchAuditBlockedCancellationLegIds } from '@/lib/orders/fetch-audit-blocked-cancellation-legs';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from '@/lib/orders/initiate-paystack-cancellation-refunds';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import { matchCancellationRefundCoverage } from '@/lib/orders/match-cancellation-refund-coverage';
import type {
  CancellationEmailSender,
  CancellationMerchant,
  CancellationOrder,
} from '@/lib/orders/order-cancellation-side-effect-types';
import { preflightCancellationRefundInitiation } from '@/lib/orders/preflight-cancellation-refund-initiation';
import { quarantineInternalOnlyManualPaystack } from '@/lib/orders/quarantine-internal-only-manual-paystack';
import { quarantineInvalidRefundAmountLegs } from '@/lib/orders/quarantine-invalid-refund-amount-legs';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { quarantineWithheldCancellationRefundLegs } from '@/lib/orders/quarantine-withheld-cancellation-refund-legs';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import {
  DeferredError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';
import { soleCompletedCancellationLeg } from '@/lib/orders/sole-completed-cancellation-leg';
import { unsupportedRefundReasons } from '@/lib/orders/unsupported-refund-reasons';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

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
  const actionableLegs = transactionRows.filter(
    (row) => row.status !== 'refunded'
  );
  if (actionableLegs.length === 0) {
    // Every leg self-terminalized (no separate refund row to initiate
    // or verify): defer so the drain reclaims and the claim observes
    // the terminal evidence and finalizes, instead of failing a row
    // with nothing actionable or completing past the finalizer.
    await tryResetCancellationSideEffectAttempts(supabase, order.id, step);
    throw new DeferredError('cancellation_refund_awaiting_provider_completion');
  }
  const allLegs = actionableLegs as GatewayPaymentTransaction[];
  // Link validity spans every funded leg (manuals allocate to cash legs).
  const transactions = allLegs.filter((t) =>
    isExternalPaymentGateway(t.gateway)
  );
  const { data: refundRows, error: refundLookupError } = await supabase
    .from('transactions')
    .select('gateway_reference, metadata, status, amount, currency, gateway')
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
  const {
    invalidLinkClaimedIds,
    invalidLinkReason,
    linkedPaymentId,
    unlinkedRefunds,
  } = classifyCancellationRefundLinks(refundRows ?? [], allLegs);
  const soleCompletedLeg = soleCompletedCancellationLeg(transactions);
  const {
    manualLinkedLegIds,
    manualPendingLegIds,
    mismatchedIds,
    mismatchedTransactions,
    refundedPaymentIds,
    unattributedUnlinkedCount,
    unverifiedLinkedLegIds,
  } = matchCancellationRefundCoverage({
    linkedPaymentId,
    refundRows,
    soleCompletedLegId: soleCompletedLeg?.id ?? null,
    transactions: allLegs,
  });
  const soleLegCovered =
    soleCompletedLeg !== undefined &&
    soleCompletedLeg !== null &&
    (refundedPaymentIds.has(soleCompletedLeg.id) ||
      unverifiedLinkedLegIds.has(soleCompletedLeg.id));
  if (invalidLinkReason !== null) {
    await quarantineRefund({
      metadata: { invalid_link_claimed_payment_ids: invalidLinkClaimedIds },
      order,
      preflight: true,
      reason: invalidLinkReason,
      supabase,
      transactions,
    });
  }
  if (
    unattributedUnlinkedCount > 0 ||
    (unlinkedRefunds.length > 0 && !soleLegCovered)
  ) {
    await quarantineRefund({
      metadata: { unlinked_refund_count: unlinkedRefunds.length },
      order,
      preflight: true,
      reason:
        'An existing refund cannot be linked to a payment leg; verify it before another provider refund',
      supabase,
      transactions,
    });
  }
  // Unsupported and reference-less legs quarantine only when uncovered:
  // a fully refunded non-Paystack leg needs no further action, and
  // terminalizing the row for it would strand the remaining Paystack
  // legs. In-flight non-Paystack legs (e.g. PayPal flips the payment row
  // itself while its provider refund is pending) are not unsupported:
  // their provider refund resolves on its own, so they must reach the
  // provider-awaiting deferral below instead. Reference-less legs still
  // quarantine — with nothing to track they can never resolve by waiting.
  const unsupportedLegs = transactions.filter(
    (transaction) =>
      !refundedPaymentIds.has(transaction.id) &&
      (!transaction.gateway_reference ||
        (normalizePaymentGateway(transaction.gateway) !== 'PAYSTACK' &&
          transaction.status !== 'refund_pending'))
  );
  if (unsupportedLegs.length > 0) {
    const unsupportedReasons = unsupportedRefundReasons(unsupportedLegs);
    await quarantineRefund({
      order,
      preflight: true,
      reason: `Automatic cancellation refund requires review: ${unsupportedReasons.join(', ')}`,
      supabase,
      transactions,
    });
  }
  // A legacy/corrupt non-finite or non-positive leg amount must
  // never reach the provider (the reduction would treat NaN as zero
  // while the predicate accepts it): quarantine it for review first.
  // The extracted backstop stays fail-closed for callers that skip
  // this preflight, and returns quietly for internal-only orders.
  await quarantineInvalidRefundAmountLegs({ order, supabase, transactions });
  assertExternalCancellationRefundableAmount(transactions);
  // Legs with a provider-accepted audit row are still in flight: the
  // reconciler completes them and the drain resumes the remaining legs.
  // Only legs without provider evidence (failed or ambiguous rows) need a
  // terminal quarantine review.
  const awaitingRefundPaymentIds = new Set<string>();
  const reviewRefundPaymentIds = new Set<string>();
  for (const row of refundRows ?? []) {
    // Terminal rows (completed or legacy refunded) are not in flight.
    if (row.status === 'completed' || row.status === 'refunded') continue;
    const paymentId = linkedPaymentId(row);
    if (typeof paymentId !== 'string') continue;
    if (
      row.status === 'refund_pending' &&
      typeof row.gateway_reference === 'string' &&
      /^[1-9][0-9]*$/.test(row.gateway_reference)
    ) {
      awaitingRefundPaymentIds.add(paymentId);
    } else {
      reviewRefundPaymentIds.add(paymentId);
    }
  }
  const pendingTransactions = transactions.filter((transaction) =>
    reviewRefundPaymentIds.has(transaction.id)
  );
  if (pendingTransactions.length > 0) {
    await quarantineRefund({
      order,
      preflight: true,
      reason: 'A previously accepted cancellation refund is not terminal',
      supabase,
      transactions: pendingTransactions,
    });
  }
  // A leg stuck in refund_pending has its provider refund in flight
  // without a separate audit row: defer it like an accepted row so the
  // step waits instead of initiating a duplicate.
  const awaitingTransactions = transactions.filter(
    (transaction) =>
      (awaitingRefundPaymentIds.has(transaction.id) ||
        transaction.status === 'refund_pending') &&
      !refundedPaymentIds.has(transaction.id)
  );
  // Legs whose only completed rows are still unverified wait for the
  // verification workers: skipping them would strand a demotion, and
  // initiating alongside them would double-refund a real row.
  const unverifiedTransactions = transactions.filter(
    (transaction) =>
      !refundedPaymentIds.has(transaction.id) &&
      unverifiedLinkedLegIds.has(transaction.id)
  );
  if (awaitingTransactions.length > 0 || unverifiedTransactions.length > 0) {
    // Defer without consuming a retry attempt: only provider
    // reconciliation can change this condition, and burning the
    // five-attempt budget on it would strand the remaining legs
    // permanently once the pending refund completes. Reset the budget
    // the order-level attempts consumed so the resumed run retries the
    // outstanding legs fresh instead of mistaking their first failure
    // for exhaustion. Best-effort: when the reset fails the resume
    // re-enters this branch while legs are still awaiting and retries
    // it then.
    await tryResetCancellationSideEffectAttempts(supabase, order.id, step);
    throw new DeferredError('cancellation_refund_awaiting_provider_completion');
  }
  // Withhold mismatched legs from initiation: their completed rows do not
  // cover them in matching money, so a full-leg provider refund now would
  // double-refund the covered portion. Audit-blocked legs withhold the
  // same way: their provider refund may already exist. Clean legs still
  // move below. Fully refunded legs need no quarantine: nothing will be
  // initiated for them, so terminalizing would only strand the rest.
  const { auditBlockedTransactions, initiationTransactions } =
    await preflightCancellationRefundInitiation({
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
    mismatchedTransactions,
    order,
    supabase,
  });
  if (manualPendingLegIds.size > 0) {
    // Never complete under a pending manual: the final record would
    // land on a completed row no drain reselects, stranding finalization.
    await tryResetCancellationSideEffectAttempts(supabase, order.id, step);
    throw new DeferredError('cancellation_refund_awaiting_manual_completion');
  }
  return { refundIds };
}

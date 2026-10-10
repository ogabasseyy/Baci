import type { SupabaseClient } from '@supabase/supabase-js';
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
import { quarantineInvalidRefundAmountLegs } from '@/lib/orders/quarantine-invalid-refund-amount-legs';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import {
  DeferredError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';
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
  // slipping to false completion.
  const { data: transactionRows, error: transactionError } = await supabase
    .from('transactions')
    .select('id, amount, currency, gateway, gateway_reference, status')
    .eq('order_id', order.id)
    .eq('merchant_id', order.merchant_id)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending'])
    .order('created_at', { ascending: true });
  if (transactionError || !transactionRows?.length) {
    throw new Error('No completed payment transaction found');
  }
  const transactions = (transactionRows as GatewayPaymentTransaction[]).filter(
    (transaction) => isExternalPaymentGateway(transaction.gateway)
  );
  if (!transactions.length) {
    throw new Error('No completed gateway payment transaction found');
  }
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
  } = classifyCancellationRefundLinks(refundRows ?? [], transactions);
  // Mirror the claim gate's sole-completed-leg attribution: an unlinked
  // legacy refund covering the only completed leg must not terminalize
  // the step while another leg's provider refund is still outstanding —
  // the completion gate attributes it and finalizes once that leg lands.
  const soleCompletedLegs = transactions.filter(
    (transaction) =>
      transaction.status === 'completed' && Number(transaction.amount) > 0
  );
  const soleCompletedLeg =
    soleCompletedLegs.length === 1 ? soleCompletedLegs[0] : null;
  const {
    mismatchedIds,
    mismatchedTransactions,
    refundedPaymentIds,
    unattributedUnlinkedCount,
    unverifiedLinkedLegIds,
  } = matchCancellationRefundCoverage({
    linkedPaymentId,
    refundRows,
    soleCompletedLegId: soleCompletedLeg?.id ?? null,
    transactions,
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
  // never reach the provider (the reduction below would treat NaN as
  // zero while the predicate accepts it): quarantine it for review
  // first. The predicate below stays as a fail-closed backstop for
  // callers that skip this preflight.
  await quarantineInvalidRefundAmountLegs({ order, supabase, transactions });
  const gatewayRefundAmount = transactions.reduce(
    (total, transaction) => total + (Number(transaction.amount) || 0),
    0
  );
  if (
    gatewayRefundAmount <= 0 ||
    transactions.some(
      (transaction) =>
        !Number.isFinite(Number(transaction.amount)) ||
        Number(transaction.amount) <= 0
    )
  ) {
    throw new Error('Completed payment transaction has no refundable amount');
  }
  // Legs with a provider-accepted audit row are still in flight: the
  // reconciler completes them and the drain resumes the remaining legs.
  // Only legs without provider evidence (failed or ambiguous rows) need a
  // terminal quarantine review.
  const awaitingRefundPaymentIds = new Set<string>();
  const reviewRefundPaymentIds = new Set<string>();
  for (const row of refundRows ?? []) {
    if (row.status === 'completed') continue;
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
  const auditBlockedTransactions = transactions.filter(
    (transaction) =>
      auditBlockedLegIds.has(transaction.id) &&
      !refundedPaymentIds.has(transaction.id)
  );
  const refundIds = await initiatePaystackCancellationRefunds({
    deadlineMs,
    isLastAttempt,
    order,
    reason,
    refundedPaymentIds,
    supabase,
    transactions: transactions.filter(
      (transaction) =>
        !mismatchedIds.has(transaction.id) &&
        !auditBlockedLegIds.has(transaction.id)
    ),
  });
  if (auditBlockedTransactions.length > 0) {
    await quarantineRefund({
      metadata: { audit_blocked_leg_count: auditBlockedTransactions.length },
      order,
      preflight: true,
      reason:
        'A provider refund event for this leg has no verified local audit row; verify it before another provider refund',
      supabase,
      transactions: auditBlockedTransactions,
    });
  }
  if (mismatchedTransactions.length > 0) {
    await quarantineRefund({
      metadata: { mismatched_leg_count: mismatchedTransactions.length },
      order,
      preflight: true,
      reason:
        'Completed cancellation refunds do not cover their payment legs; verify amounts before another provider refund',
      supabase,
      transactions: mismatchedTransactions,
    });
  }
  return { refundIds };
}

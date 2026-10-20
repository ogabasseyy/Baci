import type { SupabaseClient } from '@supabase/supabase-js';
import { assertExternalCancellationRefundableAmount } from '@/lib/orders/assert-external-cancellation-refundable-amount';
import { classifyCancellationRefundLinks } from '@/lib/orders/classify-cancellation-refund-links';
import { collectAwaitingCancellationRefundLegs } from '@/lib/orders/collect-awaiting-cancellation-refund-legs';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { matchCancellationRefundCoverage } from '@/lib/orders/match-cancellation-refund-coverage';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineInvalidRefundAmountLegs } from '@/lib/orders/quarantine-invalid-refund-amount-legs';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import {
  DeferredError,
  type OrderCancellationSideEffectStep,
} from '@/lib/orders/run-order-cancellation-side-effect';
import { unsupportedRefundReasons } from '@/lib/orders/unsupported-refund-reasons';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

export interface CancellationRefundCoveragePreflight {
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  manualLinkedLegIds: Set<string>;
  manualPendingLegIds: Set<string>;
  mismatchedIds: Set<string>;
  mismatchedTransactions: GatewayPaymentTransaction[];
  refundedPaymentIds: Set<string>;
}

// Classify refund coverage and run the quarantine/deferral preflight:
// invalid links, unlinked rows, unsupported or reference-less legs,
// non-finite amounts, non-terminal accepted rows, and in-flight
// legs. May throw DeferredError when every remaining leg is
// awaiting provider completion; otherwise returns the initiation
// inputs the executor hands to the initiation preflight.
export async function preflightCancellationRefundCoverage({
  allLegs,
  linkLegs,
  order,
  refundRows,
  soleCompletedLeg,
  step,
  supabase,
  transactions,
}: {
  allLegs: GatewayPaymentTransaction[];
  linkLegs: GatewayPaymentTransaction[];
  order: CancellationOrder;
  refundRows: {
    amount: unknown;
    currency: unknown;
    gateway: unknown;
    gateway_reference: unknown;
    metadata: unknown;
    status: unknown;
  }[];
  soleCompletedLeg: GatewayPaymentTransaction | null | undefined;
  step: OrderCancellationSideEffectStep;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<CancellationRefundCoveragePreflight> {
  const {
    invalidLinkClaimedIds,
    invalidLinkReason,
    linkedPaymentId,
    unlinkedRefunds,
  } = classifyCancellationRefundLinks(refundRows, linkLegs);
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
    orderCurrency: order.currency,
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
  // provider-awaiting deferral below instead. Manual-pending legs bypass
  // too: the merchant is still recording the balance (no provider
  // reference needed for manual records), and quarantining would
  // disable recording (delivery_uncertain) instead of deferring for
  // completion — unverifiable Paystack claims still quarantine via the
  // withheld path. Other reference-less legs quarantine: with nothing
  // to track they can never resolve by waiting.
  const unsupportedLegs = transactions.filter(
    (transaction) =>
      !refundedPaymentIds.has(transaction.id) &&
      !manualPendingLegIds.has(transaction.id) &&
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
  const { awaitingRefundPaymentIds, reviewRefundPaymentIds } =
    collectAwaitingCancellationRefundLegs({ linkedPaymentId, refundRows });
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
  return {
    linkedPaymentId,
    manualLinkedLegIds,
    manualPendingLegIds,
    mismatchedIds,
    mismatchedTransactions,
    refundedPaymentIds,
  };
}

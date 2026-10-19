import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyCancellationRefundLinks } from '@/lib/orders/classify-cancellation-refund-links';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import { matchCancellationRefundCoverage } from '@/lib/orders/match-cancellation-refund-coverage';
import { normalizeRefundMoneyField } from '@/lib/orders/normalize-refund-money-field';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { quarantineWithheldCancellationRefundLegs } from '@/lib/orders/quarantine-withheld-cancellation-refund-legs';

/**
 * Quarantine terminal-evidence anomalies on self-terminal refunded legs.
 * The aggregate claim routes such orders to the worker instead of
 * finalizing (invalid links, foreign-currency or cross-gateway rows,
 * unverified manual claims, and non-order currency legs all block it),
 * but the executor's actionable-scoped matcher never sees refunded legs
 * — in all-refunded orders it would reset and defer without ever loading
 * the evidence (spinning the drain forever), and in mixed orders it
 * would initiate on siblings and complete past anomalies the SQL gate
 * refuses to finalize. Each quarantine below throws delivery_uncertain.
 * Sole-leg attribution mirrors the executor exactly so attributable
 * rows never quarantine here; actionable-leg mismatches stay with the
 * main flow so clean siblings initiate before the step quarantines.
 * Returns the refunded legs still awaiting merchant manual completion
 * so the executor merges them into the settle deferral: the main
 * flow's matcher scopes to actionable legs and never sees them, so
 * without the merge it would complete past money still outstanding
 * that the SQL completion gate refuses to finalize.
 */
export async function quarantineRefundedLegTerminalAnomaly({
  legs,
  order,
  soleCompletedLegId,
  supabase,
}: {
  /** Every funded payment leg, refunded or still actionable. */
  legs: GatewayPaymentTransaction[];
  order: CancellationOrder;
  /** The executor's sole completed leg, or null when none exists. */
  soleCompletedLegId: string | null;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<{ refundedManualPendingLegIds: Set<string> }> {
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
  const {
    invalidLinkClaimedIds,
    invalidLinkReason,
    linkedPaymentId,
    unlinkedRefunds,
  } = classifyCancellationRefundLinks(refundRows ?? [], legs);
  const externalLegs = legs.filter((transaction) =>
    isExternalPaymentGateway(transaction.gateway)
  );
  if (invalidLinkReason !== null) {
    await quarantineRefund({
      metadata: {
        invalid_link_claimed_payment_ids: invalidLinkClaimedIds,
      },
      order,
      preflight: true,
      reason: invalidLinkReason,
      supabase,
      transactions: externalLegs,
    });
  }
  const {
    manualPendingLegIds,
    mismatchedTransactions,
    refundedPaymentIds,
    unattributedUnlinkedCount,
    unverifiedLinkedLegIds,
  } = matchCancellationRefundCoverage({
    linkedPaymentId,
    orderCurrency: order.currency,
    refundRows,
    soleCompletedLegId,
    transactions: legs,
  });
  // Mirror the executor's sole-leg forgiveness: an unlinked row the
  // main flow attributes to a covered sole leg is legitimate evidence,
  // not a blocker. Without a sole leg nothing forgives, as before.
  const soleLegCovered =
    soleCompletedLegId !== null &&
    (refundedPaymentIds.has(soleCompletedLegId) ||
      unverifiedLinkedLegIds.has(soleCompletedLegId));
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
      transactions: externalLegs,
    });
  }
  // A refunded leg prices in returned money only in the order currency;
  // anything else needs reconciliation like the preflight currency gate.
  const currencyMismatchedLegs = legs.filter(
    (leg) =>
      leg.status === 'refunded' &&
      Number(leg.amount) > 0 &&
      normalizeRefundMoneyField(leg.currency) !==
        (normalizeRefundMoneyField(order.currency) || 'NGN')
  );
  if (currencyMismatchedLegs.length > 0) {
    await quarantineRefund({
      order,
      preflight: true,
      reason: 'Payment currency requires review before refund',
      supabase,
      transactions: currencyMismatchedLegs,
    });
  }
  // Only refunded-leg mismatches quarantine here: the main flow's
  // matcher scopes to actionable legs and never sees them, while
  // actionable-leg mismatches stay with the main flow so clean
  // siblings initiate before the step quarantines.
  await quarantineWithheldCancellationRefundLegs({
    auditBlockedTransactions: [],
    mismatchedTransactions: mismatchedTransactions.filter(
      (transaction) => transaction.status === 'refunded'
    ),
    order,
    supabase,
  });
  // Refunded legs awaiting manual completion defer with the main flow
  // (merged by the caller after clean siblings initiate), never here:
  // throwing now would strand the siblings behind the merchant.
  const refundedLegIds = new Set(
    legs.filter((leg) => leg.status === 'refunded').map((leg) => leg.id)
  );
  return {
    refundedManualPendingLegIds: new Set(
      [...manualPendingLegIds].filter((legId) => refundedLegIds.has(legId))
    ),
  };
}

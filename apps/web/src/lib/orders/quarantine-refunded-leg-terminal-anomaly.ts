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
 * Quarantine terminal-evidence anomalies when every payment leg already
 * self-terminalized as refunded. The aggregate claim routes such orders
 * to the worker instead of finalizing (invalid links, foreign-currency
 * or cross-gateway rows, unverified manual claims, and non-order
 * currency legs all block it), but the executor's no-actionable-legs
 * path would otherwise reset and defer without ever loading the
 * evidence — spinning the drain forever while settlement, notifications,
 * and the dashboard stay stuck. Each quarantine below throws
 * delivery_uncertain; resolving means no terminal anomaly remains,
 * so the caller defers and the claim finalizes next pass (or an
 * in-flight provider refund still settles).
 */
export async function quarantineRefundedLegTerminalAnomaly({
  legs,
  order,
  supabase,
}: {
  /** Every funded payment leg; the caller guarantees none is actionable. */
  legs: GatewayPaymentTransaction[];
  order: CancellationOrder;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<void> {
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
  // No sole-completed-leg attribution is possible here: every leg is
  // refunded, so an unlinked row can never resolve by waiting.
  const { mismatchedTransactions, unattributedUnlinkedCount } =
    matchCancellationRefundCoverage({
      linkedPaymentId,
      refundRows,
      soleCompletedLegId: null,
      transactions: legs,
    });
  if (unattributedUnlinkedCount > 0 || unlinkedRefunds.length > 0) {
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
  await quarantineWithheldCancellationRefundLegs({
    auditBlockedTransactions: [],
    mismatchedTransactions,
    order,
    supabase,
  });
}

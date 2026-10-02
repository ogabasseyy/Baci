import type { SupabaseClient } from '@supabase/supabase-js';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
  }).format(amount);
}

// Mirror the aggregate claim gate: trimmed, uppercased gateway
// comparison with missing gateways never matching, so a legacy
// `Paystack` leg and its `paystack` refund agree on coverage here
// and in the claim gate instead of dead-lettering a notification
// for a successfully finalized order.
function normalizeLedgerGateway(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

/**
 * Total the refunded amount for a cancelled order's notification, mirroring
 * the completion RPC: every funded external payment leg sums its linked
 * same-gateway, same-currency completed refunds to at least its amount,
 * counting Paystack rows only after provider verification.
 * Refund-state legs (e.g. PayPal flips the payment row itself to
 * refund_pending while its provider refund is pending) still need their
 * linked refund; only self-terminal refunded legs carry their own
 * evidence. Unlinked legacy refunds match when the order holds exactly
 * one completed external payment leg. Throws
 * refund_notification_ledger_* on mismatch.
 */
export async function refundNotificationLedgerAmount({
  merchantId,
  order,
  supabase,
}: {
  merchantId: string;
  order: { currency: string | null; id: string };
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<string> {
  const { data: paymentLegs, error: paymentLegError } = await supabase
    .from('transactions')
    .select('id, gateway, amount, currency, status')
    .eq('order_id', order.id)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending', 'refunded']);
  if (paymentLegError || !paymentLegs?.length) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  const externalLegs = paymentLegs.filter(
    (leg) => Number(leg.amount) > 0 && isExternalPaymentGateway(leg.gateway)
  );
  const { data: refundLegs, error: refundLegError } = await supabase
    .from('transactions')
    .select('amount, currency, gateway, metadata')
    .eq('order_id', order.id)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'refund')
    .eq('status', 'completed');
  if (refundLegError) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  // Self-terminal legs (e.g. a PayPal-only cancellation flips the
  // payment row itself to refunded) carry their own evidence without a
  // separate refund transaction: an empty refund-row set is valid when
  // every external leg is self-terminal.
  if (
    !refundLegs?.length &&
    externalLegs.some((leg) => leg.status !== 'refunded')
  ) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  const refunds = refundLegs ?? [];
  // Unlinked legacy refunds mirror the completion RPC: they match only
  // the order's sole COMPLETED external payment. A refund_pending leg
  // must validate through its explicit link — counting it here would
  // reject a legacy row the RPC already accepted and dead-letter a
  // notification for a successfully finalized order.
  const completedLegs = externalLegs.filter(
    (leg) => leg.status === 'completed'
  );
  const linkedRefunds = externalLegs.map((leg) => {
    if (leg.status === 'refunded') {
      return { amount: leg.amount, currency: leg.currency };
    }
    const legCurrency = String(leg.currency ?? '').toUpperCase();
    const legGateway = normalizeLedgerGateway(leg.gateway);
    const matchedKobo = refunds
      .filter((refund) => {
        const refundGateway = normalizeLedgerGateway(refund.gateway);
        if (refundGateway === '' || refundGateway !== legGateway) return false;
        const metadata = refund.metadata as {
          payment_transaction_id?: unknown;
          provider_refund_status?: unknown;
        } | null;
        // A locally completed Paystack refund counts only after it is
        // provider-verified; other gateways keep local-status trust.
        if (
          refundGateway === 'PAYSTACK' &&
          metadata?.provider_refund_status !== 'processed'
        )
          return false;
        if (
          String(refund.currency ?? '').toUpperCase() !== legCurrency ||
          !(Number(refund.amount) > 0)
        )
          return false;
        const link = metadata?.payment_transaction_id;
        return (
          link === leg.id ||
          (link == null &&
            leg.status === 'completed' &&
            completedLegs.length === 1)
        );
      })
      .reduce(
        (sum, refund) => sum + Math.round(Number(refund.amount) * 100),
        0
      );
    if (matchedKobo < Math.round(Number(leg.amount) * 100)) return undefined;
    return { amount: matchedKobo / 100, currency: leg.currency };
  });
  if (
    externalLegs.length === 0 ||
    linkedRefunds.some((refund) => refund === undefined)
  ) {
    throw new Error('refund_notification_ledger_mismatch');
  }
  const refundAmount = (linkedRefunds as Array<{ amount: number }>).reduce(
    (sum, leg) => sum + Number(leg.amount),
    0
  );
  if (
    refundAmount <= 0 ||
    linkedRefunds.some(
      (leg) =>
        (leg as { currency: string }).currency.toUpperCase() !==
        (order.currency || 'NGN').toUpperCase()
    )
  ) {
    throw new Error('refund_notification_ledger_mismatch');
  }
  return formatAmount(refundAmount, order.currency || 'NGN');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Total the refunded amount for a cancelled order's notification, mirroring
 * the completion RPC: every funded external payment leg links one
 * same-gateway, same-amount completed refund. Refund-state legs (e.g.
 * PayPal flips the payment row itself to refund_pending while its
 * provider refund is pending) still need their linked refund; only
 * self-terminal refunded legs carry their own evidence. Unlinked legacy
 * refunds match when the order holds exactly one completed external
 * payment leg. Throws refund_notification_ledger_* on mismatch.
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
  if (refundLegError || !refundLegs?.length) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  const linkableLegs = externalLegs.filter((leg) => leg.status !== 'refunded');
  const linkedRefunds = externalLegs.map((leg) => {
    if (leg.status === 'refunded') {
      return { amount: leg.amount, currency: leg.currency };
    }
    return refundLegs.find((refund) => {
      if (
        refund.gateway !== leg.gateway ||
        Number(refund.amount) !== Number(leg.amount)
      )
        return false;
      const link = (
        refund.metadata as { payment_transaction_id?: unknown } | null
      )?.payment_transaction_id;
      return link === leg.id || (link == null && linkableLegs.length === 1);
    });
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

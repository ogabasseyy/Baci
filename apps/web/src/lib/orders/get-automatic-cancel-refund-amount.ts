import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';

interface CancelRefundOrder {
  paymentStatus: string;
  total: number;
  transactions?: Array<{
    amount: number;
    gateway: string | null;
    status: string;
    transaction_type?: string;
  }>;
}

// Mirrors the cancel_order_as_merchant RPC's refund-step seeding, which
// treats legs whose provider refund is pending or done as refund-eligible.
const AUTOMATIC_REFUND_LEG_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'refund_pending',
  'refunded',
]);

/**
 * Amount an automatic cancellation refund would send back through the
 * payment provider: completed, refund_pending or refunded payment legs on external gateways. Wallet,
 * savings, store credit, cash and similar internal legs are never refunded
 * by the worker, so an order paid only that way returns 0 and the cancel
 * dialog skips the refund choice. Unknown ledger (transactions failed to
 * load) falls back to the order total for a paid order, since the server is
 * the real gate and hiding the choice would silently force a refund.
 */
export function getAutomaticCancelRefundAmount(
  order: CancelRefundOrder
): number {
  if (order.transactions === undefined) {
    return order.paymentStatus === 'Paid' && order.total > 0 ? order.total : 0;
  }
  return order.transactions
    .filter(
      (leg) =>
        leg.transaction_type === 'payment' &&
        AUTOMATIC_REFUND_LEG_STATUSES.has(leg.status) &&
        leg.amount > 0 &&
        isExternalPaymentGateway(leg.gateway)
    )
    .reduce((sum, leg) => sum + leg.amount, 0);
}

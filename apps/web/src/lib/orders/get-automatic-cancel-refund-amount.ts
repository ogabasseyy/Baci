import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

interface CancelRefundOrder {
  paymentStatus: string;
  total: number;
  transactions?: Array<{
    amount: number;
    gateway: string | null;
    gateway_reference?: string | null;
    payment_transaction_id?: string | null;
    status: string;
    id?: string;
    transaction_type?: string;
  }>;
}

export interface CancelRefundPlan {
  /** Outstanding external amount the cancellation worker would refund. */
  amount: number;
  /**
   * False when an outstanding leg is one the worker cannot refund
   * automatically (non-Paystack, or no provider reference): the merchant
   * must refund those themselves and record it.
   */
  automaticSupported: boolean;
}

// Mirrors the cancel_order_as_merchant RPC's refund-step seeding, which
// treats legs whose provider refund is pending or done as refund-eligible.
const FUNDED_LEG_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'refund_pending',
  'refunded',
]);

/**
 * Plan for a merchant cancellation of a paid order, matching the worker:
 * funded external payment legs that no completed refund row already
 * covers. Wallet, savings, store credit, cash and similar internal legs
 * are never refunded by the worker, so an order paid only that way plans
 * 0 and the cancel dialog skips the refund choice. Self-terminal
 * `refunded` legs are already settled. Automatic refunds exist only for
 * Paystack legs with a provider reference (other uncovered legs are
 * quarantined for review by the worker), so any other outstanding leg
 * turns the automatic option off. Unknown ledger (transactions failed to
 * load) falls back to the order total for a paid order, since the server
 * is the real gate and hiding the choice would silently force a refund.
 */
export function getCancelRefundPlan(
  order: CancelRefundOrder
): CancelRefundPlan {
  if (order.transactions === undefined) {
    return {
      amount:
        order.paymentStatus === 'Paid' && order.total > 0 ? order.total : 0,
      automaticSupported: true,
    };
  }
  const coveredLegIds = new Set(
    order.transactions
      .filter(
        (row) =>
          row.transaction_type === 'refund' &&
          (row.status === 'completed' || row.status === 'refunded') &&
          row.payment_transaction_id
      )
      .map((row) => row.payment_transaction_id)
  );
  const outstanding = order.transactions.filter(
    (leg) =>
      leg.transaction_type === 'payment' &&
      FUNDED_LEG_STATUSES.has(leg.status) &&
      leg.status !== 'refunded' &&
      leg.amount > 0 &&
      isExternalPaymentGateway(leg.gateway) &&
      !(leg.id && coveredLegIds.has(leg.id))
  );
  return {
    amount: outstanding.reduce((sum, leg) => sum + leg.amount, 0),
    automaticSupported: outstanding.every(
      (leg) =>
        Boolean(leg.gateway_reference) &&
        (normalizePaymentGateway(leg.gateway) === 'PAYSTACK' ||
          leg.status === 'refund_pending')
    ),
  };
}

export function getAutomaticCancelRefundAmount(
  order: CancelRefundOrder
): number {
  return getCancelRefundPlan(order).amount;
}

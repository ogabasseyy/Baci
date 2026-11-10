const INTERNAL_PAYMENT_GATEWAYS = new Set([
  'WALLET',
  'SAVINGS',
  'STORE_CREDIT',
  'CASH',
  'MANUAL',
  'PAY_ON_DELIVERY',
]);

// Legacy rows may pad or re-case the gateway; missing or blank stays
// external, matching the server's isExternalPaymentGateway.
const normalizeGateway = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase();

const isExternalGateway = (gateway: string | null): boolean => {
  const normalized = normalizeGateway(gateway);
  return normalized === '' || !INTERNAL_PAYMENT_GATEWAYS.has(normalized);
};

export interface CancelRefundOrder {
  paymentStatus: string;
  total: number;
  transactions?: Array<{
    amount: number;
    currency?: string | null;
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
   * Amount whose provider refund is already in flight (the leg is
   * `refund_pending`). Never refunded again and never to be refunded by
   * hand: the merchant waits for it.
   */
  inFlightAmount: number;
  /**
   * False when an outstanding leg is one the worker cannot refund
   * automatically (non-Paystack, no provider reference, or only partly
   * covered by earlier refunds, which the worker withholds): the merchant
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
        order.paymentStatus.trim().toLowerCase() === 'paid' && order.total > 0
          ? order.total
          : 0,
      automaticSupported: true,
      inFlightAmount: 0,
    };
  }
  const refundRows = order.transactions.filter(
    (row) =>
      row.transaction_type === 'refund' &&
      (row.status === 'completed' || row.status === 'refunded') &&
      row.payment_transaction_id
  );
  // Money math runs in integer minor units so float remainders (0.1 + 0.7
  // vs 0.8) cannot leave a phantom sliver outstanding.
  const toMinor = (value: number): number => Math.round(value * 100);
  // A leg is covered only by completed refunds in the same currency and
  // gateway that together reach the capture; a partial refund leaves the
  // remainder outstanding.
  const coveredFor = (leg: (typeof order.transactions)[number]): number =>
    refundRows
      .filter(
        (row) =>
          row.payment_transaction_id === leg.id &&
          (row.currency ?? null) === (leg.currency ?? null) &&
          normalizeGateway(row.gateway) === normalizeGateway(leg.gateway)
      )
      .reduce((sum, row) => sum + toMinor(row.amount), 0);
  const remaining = order.transactions
    .filter(
      (leg) =>
        leg.transaction_type === 'payment' &&
        FUNDED_LEG_STATUSES.has(leg.status) &&
        leg.status !== 'refunded' &&
        leg.amount > 0 &&
        isExternalGateway(leg.gateway)
    )
    .map((leg) => {
      const covered = coveredFor(leg);
      return {
        covered,
        leg,
        remaining: Math.max(toMinor(leg.amount) - covered, 0),
      };
    })
    .filter((entry) => entry.remaining > 0);
  // A refund_pending leg already has its provider refund in flight: it is
  // tracked apart so no new refund is promised or asked of the merchant.
  const inFlight = remaining.filter(
    ({ leg }) => leg.status === 'refund_pending'
  );
  const outstanding = remaining.filter(
    ({ leg }) => leg.status !== 'refund_pending'
  );
  return {
    amount: outstanding.reduce((sum, { remaining: r }) => sum + r, 0) / 100,
    inFlightAmount:
      inFlight.reduce((sum, { remaining: r }) => sum + r, 0) / 100,
    // A partially covered leg is a coverage mismatch to the worker, which
    // withholds it for review instead of refunding the remainder.
    automaticSupported: outstanding.every(
      ({ covered, leg }) =>
        covered === 0 &&
        Boolean(leg.gateway_reference) &&
        normalizeGateway(leg.gateway) === 'PAYSTACK'
    ),
  };
}

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
    /** Refund rows: the provider's own verdict stamp (metadata). */
    provider_refund_status?: string | null;
    /** Refund rows: the stored provider refund id (metadata). */
    provider_refund_id?: string | number | null;
    status: string;
    id?: string;
    transaction_type?: string;
  }>;
}

export interface CancelRefundPlan {
  /** Outstanding external amount the cancellation worker would refund. */
  amount: number;
  /**
   * False when the ledger could not be read, or holds a refund that cannot
   * be attributed to a payment leg: the plan is then a guess, so clients must
   * not offer a manual refund on it.
   */
  ledgerKnown: boolean;
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

const DONE_REFUND_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'refunded',
]);

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/**
 * A non-terminal refund row still counts as money in flight or under review,
 * mirroring the worker's collectAwaitingCancellationRefundLegs: every
 * non-completed linked row is, except a definitive provider rejection
 * (failed with a failed provider stamp) that carries no provider identity,
 * which can never recover and so waits for nothing. A failed row WITH a
 * numeric gateway reference or stored provider id can still flip to
 * processed later, so refunding it by hand could double-pay.
 */
function isRefundInFlightRow(row: {
  gateway_reference?: string | null;
  provider_refund_id?: string | number | null;
  provider_refund_status?: string | null;
  status: string;
}): boolean {
  if (DONE_REFUND_STATUSES.has(row.status)) return false;
  if (row.status === 'failed' && row.provider_refund_status === 'failed') {
    const reference = (row.gateway_reference ?? '').trim();
    const stored = row.provider_refund_id;
    const hasIdentity =
      POSITIVE_INTEGER.test(reference) ||
      (typeof stored === 'number' &&
        Number.isSafeInteger(stored) &&
        stored > 0) ||
      (typeof stored === 'string' && POSITIVE_INTEGER.test(stored.trim()));
    return hasIdentity;
  }
  return true;
}

/** Paid check that tolerates the case variants stored across apps. */
export function isPaidStatus(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'paid';
}

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
        isPaidStatus(order.paymentStatus) && order.total > 0 ? order.total : 0,
      automaticSupported: true,
      inFlightAmount: 0,
      ledgerKnown: false,
    };
  }
  // Money math runs in integer minor units so float remainders (0.1 + 0.7
  // vs 0.8) cannot leave a phantom sliver outstanding.
  const toMinor = (value: number): number => Math.round(value * 100);
  const legs = order.transactions.filter(
    (leg) =>
      leg.transaction_type === 'payment' &&
      FUNDED_LEG_STATUSES.has(leg.status) &&
      leg.amount > 0 &&
      isExternalGateway(leg.gateway)
  );
  // An unlinked refund row (legacy, or a manual record against the only
  // capture) belongs to the sole external payment leg, like the worker's
  // attribution; with several candidate legs it stays unattributed.
  const soleLegId = legs.length === 1 ? legs[0]?.id : undefined;
  const refundRows = order.transactions.filter(
    (row) => row.transaction_type === 'refund'
  );
  // Completed refunds cover a leg only in the same currency and gateway.
  // An unlinked one belongs to the sole payment leg, like the worker's
  // attribution; with several candidate legs it stays unattributed.
  const coveredFor = (leg: (typeof order.transactions)[number]): number =>
    refundRows
      .filter(
        (row) =>
          DONE_REFUND_STATUSES.has(row.status) &&
          (row.payment_transaction_id || soleLegId) === leg.id &&
          (row.currency ?? null) === (leg.currency ?? null) &&
          normalizeGateway(row.gateway) === normalizeGateway(leg.gateway)
      )
      .reduce((sum, row) => sum + toMinor(row.amount), 0);
  // Non-terminal refund rows need an explicit link (the worker ignores
  // unlinked ones) and count as in flight, even while the payment leg
  // stays completed.
  const pendingFor = (leg: (typeof order.transactions)[number]): number =>
    refundRows
      .filter(
        (row) =>
          row.payment_transaction_id === leg.id && isRefundInFlightRow(row)
      )
      .reduce((sum, row) => sum + toMinor(row.amount), 0);
  // The worker quarantines an order holding refund evidence it cannot
  // attribute, so the plan cannot say what is owed. An unlinked COMPLETED
  // refund only stays unattributable when several legs could own it (a sole
  // leg owns it); unlinked NON-TERMINAL evidence (pending, processing, or a
  // recoverable failed row) is unattributable even with a single leg.
  // A refund that claims a payment id no funded leg of this order carries is
  // a stale or cross-order link, which the worker also quarantines
  // (classifyCancellationRefundLinks): every status counts, as there.
  const fundedPaymentIds = new Set(
    order.transactions
      .filter(
        (row) =>
          row.transaction_type === 'payment' &&
          FUNDED_LEG_STATUSES.has(row.status) &&
          row.id
      )
      .map((row) => row.id)
  );
  const unresolved = refundRows.some((row) =>
    row.payment_transaction_id
      ? !fundedPaymentIds.has(row.payment_transaction_id)
      : (legs.length > 1 && DONE_REFUND_STATUSES.has(row.status)) ||
        isRefundInFlightRow(row)
  );
  const entries = legs
    .filter((leg) => leg.status !== 'refunded')
    .map((leg) => {
      const covered = coveredFor(leg);
      const open = Math.max(toMinor(leg.amount) - covered, 0);
      const inFlightMinor =
        leg.status === 'refund_pending'
          ? open
          : Math.min(open, pendingFor(leg));
      return { covered, inFlightMinor, leg, owed: open - inFlightMinor };
    });
  const outstanding = entries.filter(({ owed }) => owed > 0);
  return {
    amount: outstanding.reduce((sum, { owed }) => sum + owed, 0) / 100,
    inFlightAmount:
      entries.reduce((sum, { inFlightMinor }) => sum + inFlightMinor, 0) / 100,
    ledgerKnown: !unresolved,
    // A partially covered leg (or one with a refund already in flight) is a
    // coverage mismatch to the worker, which withholds it for review
    // instead of refunding the remainder.
    automaticSupported: outstanding.every(
      ({ covered, inFlightMinor, leg }) =>
        covered === 0 &&
        inFlightMinor === 0 &&
        Boolean(leg.gateway_reference) &&
        normalizeGateway(leg.gateway) === 'PAYSTACK'
    ),
  };
}

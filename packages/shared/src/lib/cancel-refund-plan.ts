import { hasUnresolvedRefundEvidence } from './cancel-refund-attribution';
import { exceedsRecordedPaid } from './cancel-refund-paid-cap';

const INTERNAL_PAYMENT_GATEWAYS = new Set([
  'WALLET',
  'SAVINGS',
  'STORE_CREDIT',
  'CASH',
  'MANUAL',
  'PAY_ON_DELIVERY',
]);

// Legacy rows may pad or re-case the gateway and the ISO currency code (the
// worker's normalizeRefundMoneyField does the same for both); missing or blank stays
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
  /**
   * The order's recorded paid amount (orders.amount_paid). Pass a number when
   * it was read, and `null` when it is missing or unreadable (the plan is then
   * unresolved). Outstanding captures above it are an overfunded or
   * unreconciled ledger that the worker quarantines, so the plan is neutral.
   * Omitted only by callers that cannot know the order row.
   */
  amountPaid?: number | null;
  /** Order currency; blank defaults to NGN like the worker. */
  orderCurrency?: string | null;
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
    /** Manual refund rows: the method the merchant declared (metadata). */
    refund_method?: string | null;
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

// Money math runs in integer minor units so float remainders (0.1 + 0.7
// vs 0.8) cannot leave a phantom sliver outstanding.
const toMinor = (value: number): number => Math.round(value * 100);

function hasPositiveAmount(row: { amount: number }): boolean {
  return Number.isFinite(row.amount) && row.amount > 0;
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
  // Like the worker's soleCompletedCancellationLeg, only a COMPLETED leg
  // can own it, never a refund_pending or refunded sibling.
  const completedLegs = legs.filter((leg) => leg.status === 'completed');
  const soleLegId =
    completedLegs.length === 1 ? completedLegs[0]?.id : undefined;
  const refundRows = order.transactions.filter(
    (row) => row.transaction_type === 'refund'
  );
  // Completed refunds cover a leg only in the same currency and gateway.
  // An unlinked one belongs to the sole payment leg, like the worker's
  // attribution; with several candidate legs it stays unattributed. A
  // Paystack row without a processed provider verdict is NOT settled
  // coverage: the worker waits for verification, so such a leg is reported
  // as awaiting the provider (in flight), never covered and never owed.
  const doneRowsFor = (leg: (typeof order.transactions)[number]) =>
    refundRows.filter(
      (row) =>
        DONE_REFUND_STATUSES.has(row.status) &&
        (row.payment_transaction_id || soleLegId) === leg.id &&
        normalizeGateway(row.currency) === normalizeGateway(leg.currency) &&
        // Merchant-recorded manual rows (gateway MANUAL) cover by matching
        // money only, like the worker; others must match the leg's gateway.
        (normalizeGateway(row.gateway) === 'MANUAL' ||
          normalizeGateway(row.gateway) === normalizeGateway(leg.gateway))
    );
  const isUnverifiedPaystack = (row: {
    gateway: string | null;
    provider_refund_status?: string | null;
  }): boolean =>
    normalizeGateway(row.gateway) === 'PAYSTACK' &&
    row.provider_refund_status !== 'processed';
  const coveredFor = (leg: (typeof order.transactions)[number]): number =>
    doneRowsFor(leg)
      .filter((row) => !isUnverifiedPaystack(row) && hasPositiveAmount(row))
      .reduce((sum, row) => sum + toMinor(row.amount), 0);
  const awaitingVerification = (
    leg: (typeof order.transactions)[number]
  ): boolean => doneRowsFor(leg).some(isUnverifiedPaystack);
  // Non-terminal refund rows need an explicit link (the worker ignores
  // unlinked ones) and count as in flight, even while the payment leg
  // stays completed.
  const pendingFor = (leg: (typeof order.transactions)[number]): number =>
    refundRows
      .filter(
        (row) =>
          row.payment_transaction_id === leg.id &&
          isRefundInFlightRow(row) &&
          hasPositiveAmount(row)
      )
      .reduce((sum, row) => sum + toMinor(row.amount), 0);
  // Every condition under which the worker quarantines the order for refund
  // evidence it cannot attribute or reconcile leaves the plan unresolved.
  // Any refund row, whatever its status or link, with a zero, negative or
  // non-numeric amount is evidence that cannot be sized: it is never summed
  // (a -20 manual row must not inflate what is owed) and the plan is
  // unresolved.
  const unsizableRefund = refundRows.some((row) => !hasPositiveAmount(row));
  const unresolved =
    unsizableRefund ||
    hasUnresolvedRefundEvidence(order.transactions, order.orderCurrency);
  const entries = legs
    .filter((leg) => leg.status !== 'refunded')
    .map((leg) => {
      const covered = coveredFor(leg);
      const open = Math.max(toMinor(leg.amount) - covered, 0);
      const inFlightMinor =
        leg.status === 'refund_pending' || awaitingVerification(leg)
          ? open
          : Math.min(open, pendingFor(leg));
      return { covered, inFlightMinor, leg, owed: open - inFlightMinor };
    });
  const outstanding = entries.filter(({ owed }) => owed > 0);
  // Never sum different currencies: an open leg with a blank currency, or one
  // that differs from the order's (blank defaults to NGN), is what
  // preflightCancellationRefundInitiation quarantines for review.
  const orderCurrencyCode = normalizeGateway(order.orderCurrency) || 'NGN';
  const currencyMismatch = entries.some(
    ({ inFlightMinor, leg, owed }) =>
      owed + inFlightMinor > 0 &&
      (normalizeGateway(leg.currency) === '' ||
        normalizeGateway(leg.currency) !== orderCurrencyCode)
  );
  const overfunded =
    order.amountPaid !== undefined &&
    exceedsRecordedPaid({
      amountPaid: order.amountPaid,
      // Funded non-wallet legs in the order currency (effective_amount_paid_v1).
      derivedPaidMinor: order.transactions
        .filter(
          (leg) =>
            leg.transaction_type === 'payment' &&
            FUNDED_LEG_STATUSES.has(leg.status) &&
            normalizeGateway(leg.currency) === orderCurrencyCode &&
            !['WALLET', 'SAVINGS'].includes(normalizeGateway(leg.gateway))
        )
        .reduce((sum, leg) => sum + toMinor(leg.amount), 0),
      outstandingMinor: entries
        .filter(({ covered, leg }) => toMinor(leg.amount) - covered > 0)
        .reduce((sum, { leg }) => sum + toMinor(leg.amount), 0),
    });
  return {
    amount: outstanding.reduce((sum, { owed }) => sum + owed, 0) / 100,
    inFlightAmount:
      entries.reduce((sum, { inFlightMinor }) => sum + inFlightMinor, 0) / 100,
    ledgerKnown: !unresolved && !currencyMismatch && !overfunded,
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

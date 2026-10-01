import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';

interface CancellationRefundRow {
  amount: unknown;
  currency: unknown;
  gateway: unknown;
  metadata: unknown;
  status: unknown;
}

/**
 * Match completed refund rows against their payment legs. A completed row
 * marks its leg refunded only when it matches the leg's own gateway and
 * currency and the matched rows cover the full leg amount: a partial or
 * foreign row must quarantine for reconciliation instead of silently
 * skipping the remaining balance. Paystack rows count only after
 * provider verification, mirroring the completion RPC; unverified rows
 * wait for the verification workers instead of triggering another
 * provider refund.
 */
export function matchCancellationRefundCoverage({
  linkedPaymentId,
  refundRows,
  transactions,
}: {
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  refundRows: CancellationRefundRow[] | null;
  transactions: GatewayPaymentTransaction[];
}): {
  mismatchedIds: Set<string>;
  mismatchedTransactions: GatewayPaymentTransaction[];
  refundedPaymentIds: Set<string>;
  unverifiedLinkedLegIds: Set<string>;
} {
  const normalizeMoneyField = (value: unknown): string =>
    String(value ?? '')
      .trim()
      .toUpperCase();
  const legById = new Map(transactions.map((leg) => [leg.id, leg]));
  const matchedRefundKobo = new Map<string, number>();
  const completedLinkedLegIds = new Set<string>();
  const unverifiedLinkedLegIds = new Set<string>();
  for (const row of refundRows ?? []) {
    if (row.status !== 'completed') continue;
    const paymentId = linkedPaymentId(row);
    if (paymentId === null) continue;
    completedLinkedLegIds.add(paymentId);
    const leg = legById.get(paymentId);
    if (!leg) continue;
    if (
      normalizeMoneyField(row.gateway) !== normalizeMoneyField(leg.gateway) ||
      normalizeMoneyField(row.currency) !== normalizeMoneyField(leg.currency)
    ) {
      continue;
    }
    if (
      normalizeMoneyField(row.gateway) === 'PAYSTACK' &&
      (row.metadata as { provider_refund_status?: unknown } | null)
        ?.provider_refund_status !== 'processed'
    ) {
      unverifiedLinkedLegIds.add(paymentId);
      continue;
    }
    const rowKobo = Math.round(Number(row.amount) * 100);
    if (!Number.isSafeInteger(rowKobo) || rowKobo <= 0) continue;
    matchedRefundKobo.set(
      paymentId,
      (matchedRefundKobo.get(paymentId) ?? 0) + rowKobo
    );
  }
  const refundedPaymentIds = new Set<string>();
  const mismatchedTransactions: GatewayPaymentTransaction[] = [];
  for (const leg of transactions) {
    const legKobo = Math.round(Number(leg.amount) * 100);
    if ((matchedRefundKobo.get(leg.id) ?? 0) >= legKobo) {
      refundedPaymentIds.add(leg.id);
    } else if (completedLinkedLegIds.has(leg.id)) {
      mismatchedTransactions.push(leg);
    }
  }
  const mismatchedIds = new Set(
    mismatchedTransactions.map((transaction) => transaction.id)
  );
  return {
    mismatchedIds,
    mismatchedTransactions,
    refundedPaymentIds,
    unverifiedLinkedLegIds,
  };
}

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
 * provider refund. Unlinked completed rows attribute to the sole
 * completed leg when the caller names one, mirroring the claim SQL —
 * never to a refund_pending leg — so a legacy refund plus an
 * in-flight leg defers instead of terminalizing before the completion
 * gate runs.
 */
export function matchCancellationRefundCoverage({
  linkedPaymentId,
  refundRows,
  soleCompletedLegId = null,
  transactions,
}: {
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  refundRows: CancellationRefundRow[] | null;
  soleCompletedLegId?: string | null;
  transactions: GatewayPaymentTransaction[];
}): {
  mismatchedIds: Set<string>;
  mismatchedTransactions: GatewayPaymentTransaction[];
  refundedPaymentIds: Set<string>;
  unattributedUnlinkedCount: number;
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
  let unattributedUnlinkedCount = 0;
  for (const row of refundRows ?? []) {
    const linkedId = linkedPaymentId(row);
    // Attributed rows target the sole completed leg; anything that
    // cannot target it stays unattributed so the caller quarantines
    // instead of silently dropping evidence the claim gate ignores.
    const attributed = linkedId === null && soleCompletedLegId !== null;
    const paymentId = linkedId ?? (attributed ? soleCompletedLegId : null);
    if (row.status !== 'completed' || paymentId === null) {
      if (linkedId === null) unattributedUnlinkedCount += 1;
      continue;
    }
    completedLinkedLegIds.add(paymentId);
    const leg = legById.get(paymentId);
    if (!leg) {
      if (attributed) unattributedUnlinkedCount += 1;
      continue;
    }
    // Attributed rows keep the claim SQL's exact gateway equality: the
    // linked path normalizes case, but attribution must never exceed
    // what the gate covers, or the leg would defer forever — covered
    // here, uncovered there — instead of refunding or quarantining.
    const gatewayMatches = attributed
      ? row.gateway === leg.gateway
      : normalizeMoneyField(row.gateway) === normalizeMoneyField(leg.gateway);
    if (
      !gatewayMatches ||
      normalizeMoneyField(row.currency) !== normalizeMoneyField(leg.currency)
    ) {
      if (attributed) unattributedUnlinkedCount += 1;
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
    if (!Number.isSafeInteger(rowKobo) || rowKobo <= 0) {
      if (attributed) unattributedUnlinkedCount += 1;
      continue;
    }
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
    unattributedUnlinkedCount,
    unverifiedLinkedLegIds,
  };
}

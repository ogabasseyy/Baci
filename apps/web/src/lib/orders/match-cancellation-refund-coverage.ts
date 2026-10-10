import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';

interface CancellationRefundRow {
  amount: unknown;
  currency: unknown;
  gateway: unknown;
  metadata: unknown;
  status: unknown;
}

/**
 * Claim-gate money comparison: legacy rows pad or re-case ISO codes
 * (`ngn`, ` NGN `), so every currency/gateway equality trims and
 * uppercases instead of comparing raw text.
 */
export function normalizeRefundMoneyField(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
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
 * gate runs. Merchant-attested manual rows always link explicitly and
 * count as coverage in matching money, mirroring the aggregate claim;
 * legs carrying them never initiate (double-refund protection) and
 * never mismatch for the manual rows themselves, so a partial manual
 * record waits for the merchant instead of quarantining.
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
  manualLinkedLegIds: Set<string>;
  mismatchedIds: Set<string>;
  mismatchedTransactions: GatewayPaymentTransaction[];
  refundedPaymentIds: Set<string>;
  unattributedUnlinkedCount: number;
  unverifiedLinkedLegIds: Set<string>;
} {
  const normalizeMoneyField = normalizeRefundMoneyField;
  const legById = new Map(transactions.map((leg) => [leg.id, leg]));
  const matchedRefundKobo = new Map<string, number>();
  const completedLinkedLegIds = new Set<string>();
  const manualLinkedLegIds = new Set<string>();
  const badManualLegIds = new Set<string>();
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
    const leg = legById.get(paymentId);
    if (!leg) {
      if (attributed) unattributedUnlinkedCount += 1;
      continue;
    }
    const rowGateway = normalizeMoneyField(row.gateway);
    const isManualRow = rowGateway === 'MANUAL';
    const currencyMatches =
      normalizeMoneyField(row.currency) === normalizeMoneyField(leg.currency);
    if (isManualRow && linkedId !== null) {
      // Explicitly linked manual rows always block provider initiation
      // on their leg; matching-money rows below also count as coverage.
      manualLinkedLegIds.add(paymentId);
      if (!currencyMatches) {
        badManualLegIds.add(paymentId);
        continue;
      }
    } else if (isManualRow) {
      // Unlinked manual rows cannot safely target the sole leg.
      unattributedUnlinkedCount += 1;
      continue;
    } else {
      completedLinkedLegIds.add(paymentId);
    }
    // Both paths normalize exactly like the claim gate
    // (whitespace-trimmed, uppercased; missing gateways never match):
    // exact equality here would disagree with the gate on a legacy
    // `Paystack` leg with a `paystack` refund, quarantining the side
    // effect as delivery_uncertain while the claim still sees the
    // leg covered by the remaining refund_pending leg. The gateway
    // column permits null, and equating missing gateways would mark
    // a legacy leg covered here while the aggregate claim never
    // recognizes it — finishing the side effect as completed with
    // the order paid and settlement unreversed. Missing gateways
    // mismatch into quarantine instead.
    const gatewayMatches =
      rowGateway !== '' && rowGateway === normalizeMoneyField(leg.gateway);
    if ((!gatewayMatches && !isManualRow) || !currencyMatches) {
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
    } else if (
      completedLinkedLegIds.has(leg.id) ||
      badManualLegIds.has(leg.id)
    ) {
      mismatchedTransactions.push(leg);
    }
    // A manual-linked leg with no other evidence waits for the
    // merchant: the caller excludes it from initiation without
    // quarantining, so partial manual records never strand.
  }
  const mismatchedIds = new Set(
    mismatchedTransactions.map((transaction) => transaction.id)
  );
  return {
    manualLinkedLegIds,
    mismatchedIds,
    mismatchedTransactions,
    refundedPaymentIds,
    unattributedUnlinkedCount,
    unverifiedLinkedLegIds,
  };
}

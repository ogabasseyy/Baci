interface LinkRow {
  metadata: unknown;
}

interface LegTransaction {
  id: string;
}

/** Raw payment_transaction_id claim from a refund row's metadata. */
export function claimedRefundPaymentId(row: LinkRow): string | null {
  const metadata = row.metadata as {
    payment_transaction_id?: unknown;
  } | null;
  const paymentId = metadata?.payment_transaction_id;
  return typeof paymentId === 'string' ? paymentId : null;
}

/**
 * Split refund rows into linked, unlinked, and invalid-link sets. A link
 * naming a payment id outside this order's legs is corruption (stale
 * backfill, cross-order write) — not a legacy unlinked refund the
 * sole-payment rule may attribute — so it quarantines separately with
 * the claimed target named.
 */
export function classifyCancellationRefundLinks<
  T extends LinkRow,
  L extends LegTransaction,
>(
  refundRows: readonly T[],
  transactions: readonly L[]
): {
  invalidLinkClaimedIds: string[];
  invalidLinkRefunds: T[];
  invalidLinkReason: string | null;
  linkedPaymentId: (row: LinkRow) => string | null;
  unlinkedRefunds: T[];
} {
  const linkedPaymentId = (row: LinkRow): string | null => {
    const claimed = claimedRefundPaymentId(row);
    return claimed !== null &&
      transactions.some((transaction) => transaction.id === claimed)
      ? claimed
      : null;
  };
  const invalidLinkRefunds = refundRows.filter(
    (row) =>
      claimedRefundPaymentId(row) !== null && linkedPaymentId(row) === null
  );
  const invalidLinkClaimedIds = [
    ...new Set(
      invalidLinkRefunds
        .map((row) => claimedRefundPaymentId(row))
        .filter((id): id is string => id !== null)
    ),
  ];
  return {
    invalidLinkClaimedIds,
    invalidLinkRefunds,
    invalidLinkReason:
      invalidLinkRefunds.length > 0
        ? `An existing refund links to payment legs outside this order (${invalidLinkClaimedIds.join(', ')}); verify it before another provider refund`
        : null,
    linkedPaymentId,
    unlinkedRefunds: refundRows.filter(
      (row) => claimedRefundPaymentId(row) === null
    ),
  };
}

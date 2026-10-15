interface AwaitingRefundRow {
  gateway_reference: unknown;
  metadata: unknown;
  status: unknown;
}

/**
 * Split non-terminal refund rows by provider evidence. Legs with a
 * provider-accepted audit row (refund_pending with a numeric provider
 * id) are still in flight: the reconciler completes them and the
 * drain resumes the remaining legs. Only legs without provider
 * evidence (failed or ambiguous rows) need a terminal quarantine
 * review. Terminal rows (completed or legacy refunded) and rows
 * without a resolvable link are not in flight.
 */
export function collectAwaitingCancellationRefundLegs({
  linkedPaymentId,
  refundRows,
}: {
  linkedPaymentId: (row: { metadata: unknown }) => string | null;
  refundRows: readonly AwaitingRefundRow[] | null;
}): {
  awaitingRefundPaymentIds: Set<string>;
  reviewRefundPaymentIds: Set<string>;
} {
  const awaitingRefundPaymentIds = new Set<string>();
  const reviewRefundPaymentIds = new Set<string>();
  for (const row of refundRows ?? []) {
    if (row.status === 'completed' || row.status === 'refunded') continue;
    const paymentId = linkedPaymentId(row);
    if (typeof paymentId !== 'string') continue;
    if (
      row.status === 'refund_pending' &&
      typeof row.gateway_reference === 'string' &&
      /^[1-9][0-9]*$/.test(row.gateway_reference)
    ) {
      awaitingRefundPaymentIds.add(paymentId);
    } else {
      reviewRefundPaymentIds.add(paymentId);
    }
  }
  return { awaitingRefundPaymentIds, reviewRefundPaymentIds };
}

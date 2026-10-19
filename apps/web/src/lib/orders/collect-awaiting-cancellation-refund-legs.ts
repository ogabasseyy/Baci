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
 * review — except definitive provider rejections (failed with a
 * failed provider stamp) that carry no recoverable provider
 * identity: the SQL pending gate does not count those, so the
 * manager exposes retry and manual recovery for the leg, and
 * quarantining here would strand it behind review. A failed row
 * WITH provider identity (numeric gateway reference or stored
 * provider id) still needs review: the transition, sweep, and
 * webhook all recheck failed rows for a later processed verdict,
 * so retrying the leg fresh could double-refund if the original
 * recovers. Terminal rows (completed or legacy refunded) and rows
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
    // A definitive provider rejection with no recoverable provider
    // identity is provably dead: no later verdict can land on it, so
    // it waits for nothing and needs no review — the leg retries
    // fresh or recovers manually. With provider identity (numeric
    // gateway reference or stored provider id) the row can still
    // recover through the transition, sweep, or webhook rechecks, so
    // the leg needs review instead of a fresh retry that would
    // double-refund if the original flips processed.
    if (
      row.status === 'failed' &&
      (row.metadata as { provider_refund_status?: unknown } | null)
        ?.provider_refund_status === 'failed'
    ) {
      const metadata = row.metadata as {
        provider_refund_id?: unknown;
      } | null;
      const storedId = metadata?.provider_refund_id;
      const reference =
        typeof row.gateway_reference === 'string'
          ? row.gateway_reference.trim()
          : '';
      const hasProviderIdentity =
        /^[1-9][0-9]*$/.test(reference) ||
        (typeof storedId === 'number' &&
          Number.isSafeInteger(storedId) &&
          storedId > 0) ||
        (typeof storedId === 'string' && /^[1-9][0-9]*$/.test(storedId.trim()));
      if (!hasProviderIdentity) {
        continue;
      }
      reviewRefundPaymentIds.add(paymentId);
      continue;
    }
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

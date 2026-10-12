/**
 * Shared Paystack webhook envelope readers for the primary-card
 * checkout paths. The charge reconciler and the reversal reconciler
 * parse the same delivery independently (reversals carry the original
 * reference in transaction_reference, which the charge path never
 * reads), so the shape helpers live here instead of in either path —
 * and outside the modules the dispatch tests mock.
 */
export function webhookObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function webhookMetadataOf(
  body: unknown
): Record<string, unknown> | null {
  const data = webhookObject(
    body && typeof body === 'object' && 'data' in body ? body.data : null
  );
  if (!data) return null;
  let metadata: unknown = data.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  return webhookObject(metadata);
}

/**
 * Money-out events against a checkout reference. Refunds carry the
 * original reference in top-level `transaction_reference`; disputes
 * (create and resolve) carry it in the dispute object's
 * `transaction_ref` or nested `transaction.reference` instead.
 */
export const REVERSAL_EVENTS = [
  'refund.processed',
  'charge.dispute.create',
  'charge.dispute.resolve',
] as const;

export function isReversalEvent(event: unknown): boolean {
  return (
    typeof event === 'string' &&
    (REVERSAL_EVENTS as readonly string[]).includes(event)
  );
}

export function reversalTransactionReference(
  data: Record<string, unknown>
): string | null {
  for (const key of ['transaction_reference', 'transaction_ref']) {
    const direct = data[key];
    if (typeof direct === 'string' && direct) return direct;
  }
  for (const key of ['transaction', 'dispute']) {
    const nested = webhookObject(data[key]);
    const candidate =
      nested && typeof nested.reference === 'string' && nested.reference
        ? nested.reference
        : null;
    if (candidate) return candidate;
  }
  return null;
}

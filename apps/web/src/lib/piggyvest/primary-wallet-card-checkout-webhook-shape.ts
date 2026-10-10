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

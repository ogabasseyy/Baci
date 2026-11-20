/**
 * The vendReference Monnify itself put in a rejected answer's responseBody,
 * the only reference its requery resolves (#2784). An echo of our own
 * request reference is not one (requery by it reports "not found" even for
 * delivered vends), so it is ignored and the row is held for review.
 */
export function readMonnifyRejectionVendReference(
  answer: unknown,
  requestReference: string
): string | undefined {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return undefined;
  }
  const body = (answer as Record<string, unknown>).responseBody;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>).vendReference;
  if (typeof value !== 'string') {
    return undefined;
  }
  const reference = value.trim();
  if (
    !reference ||
    reference.toLowerCase() === requestReference.trim().toLowerCase()
  ) {
    return undefined;
  }
  return reference;
}

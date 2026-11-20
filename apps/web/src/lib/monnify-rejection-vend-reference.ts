const MAX_DEPTH = 6;

function normaliseKey(key: string): string {
  return key.replace(/[\s_-]/g, '').toLowerCase();
}

/**
 * The first string `vendReference` found under a `responseBody` key, in any
 * key casing or "_"/"-" spelling and at any depth: JSON, or a form-encoded
 * answer parsed into nested objects or an array of one-pair objects.
 */
export function findMonnifyBodyVendReference(
  answer: unknown,
  insideBody = false,
  depth = 0
): string | undefined {
  if (!answer || typeof answer !== 'object' || depth > MAX_DEPTH) {
    return undefined;
  }
  if (Array.isArray(answer)) {
    for (const item of answer) {
      const found = findMonnifyBodyVendReference(item, insideBody, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  for (const [rawKey, value] of Object.entries(answer)) {
    const key = normaliseKey(rawKey);
    if (insideBody && key === 'vendreference' && typeof value === 'string') {
      const reference = value.trim();
      if (reference) {
        return reference;
      }
    }
    const found = findMonnifyBodyVendReference(
      value,
      insideBody || key === 'responsebody',
      depth + 1
    );
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Drops an echo of our own request reference: Monnify's requery resolves only
 * the vendReference Monnify itself returned (#2784), and reports "not found"
 * for ours even on delivered vends, so an echo is not a requeryable reference
 * and the row is held for review instead.
 */
export function ignoreMonnifyRequestEcho(
  candidate: string | undefined,
  requestReference: string
): string | undefined {
  if (
    !candidate ||
    candidate.toLowerCase() === requestReference.trim().toLowerCase()
  ) {
    return undefined;
  }
  return candidate;
}

/** Monnify's own vendReference in a rejected answer's responseBody, if any. */
export function readMonnifyRejectionVendReference(
  answer: unknown,
  requestReference: string
): string | undefined {
  return ignoreMonnifyRequestEcho(
    findMonnifyBodyVendReference(answer),
    requestReference
  );
}

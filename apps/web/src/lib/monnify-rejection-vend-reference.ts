const MAX_DEPTH = 6;

/** Baci's own request references are 24 hex characters (generateRequestRef). */
const OWN_REQUEST_REFERENCE = /^[0-9a-f]{24}$/i;

function normaliseKey(key: string): string {
  return key.replace(/[\s_-]/g, '').toLowerCase();
}

interface Found {
  depth: number;
  value: string;
}

/**
 * Every non-blank string under `fieldKey` (normalised) inside a `responseBody`
 * object, with its depth, in any key casing / "_" or "-" spelling: JSON, or a
 * form-encoded answer parsed into nested objects or one-pair arrays.
 */
function collectBodyField(
  answer: unknown,
  fieldKey: string,
  out: Found[],
  insideBody = false,
  depth = 0
): void {
  if (!answer || typeof answer !== 'object' || depth > MAX_DEPTH) {
    return;
  }
  const children = Array.isArray(answer)
    ? answer.map((item) => ['', item] as const)
    : Object.entries(answer);
  for (const [rawKey, value] of children) {
    const key = normaliseKey(rawKey);
    if (insideBody && key === fieldKey && typeof value === 'string') {
      const text = value.trim();
      if (text) {
        out.push({ depth, value: text });
      }
    }
    collectBodyField(
      value,
      fieldKey,
      out,
      insideBody || key === 'responsebody',
      depth + 1
    );
  }
}

/**
 * The reference at the shallowest depth. When two different references sit at
 * that depth the answer is ambiguous (history, batch, echoed objects): no
 * reference is returned, so the row is held for review instead of requerying
 * the wrong vend.
 */
function pickShallowest(found: Found[]): string | undefined {
  if (found.length === 0) {
    return undefined;
  }
  const shallowest = Math.min(...found.map((item) => item.depth));
  const values = new Set(
    found.filter((item) => item.depth === shallowest).map((item) => item.value)
  );
  return values.size === 1 ? [...values][0] : undefined;
}

/** Monnify's own `responseBody.vendReference`, if the answer carries one. */
export function findMonnifyBodyVendReference(
  answer: unknown
): string | undefined {
  const found: Found[] = [];
  collectBodyField(answer, 'vendreference', found);
  return pickShallowest(found);
}

/**
 * Whether the answer carries a Monnify-issued reference in its responseBody:
 * a transactionReference or vendReference that is not an echo of our own
 * request reference shape. Such a body means a vend may exist.
 */
export function hasMonnifyProviderReference(answer: unknown): boolean {
  const transaction: Found[] = [];
  collectBodyField(answer, 'transactionreference', transaction);
  const vend: Found[] = [];
  collectBodyField(answer, 'vendreference', vend);
  return [...transaction, ...vend].some(
    (item) => !OWN_REQUEST_REFERENCE.test(item.value)
  );
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

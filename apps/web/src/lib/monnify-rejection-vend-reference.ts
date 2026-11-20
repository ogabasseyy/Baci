const MAX_DEPTH = 6;

function normaliseKey(key: string): string {
  return key.replace(/[\s_-]/g, '').toLowerCase();
}

interface Found {
  depth: number;
  value: string;
}

type KeyMatcher = (
  key: string,
  insideBody: boolean,
  underNonVend: boolean
) => boolean;

/**
 * Every non-blank string or numeric value under a key the matcher accepts,
 * with its depth, in any key casing / "_" or "-" spelling: JSON, or a
 * form-encoded answer parsed into nested objects or one-pair arrays.
 */
function collectBodyField(
  answer: unknown,
  matches: KeyMatcher,
  out: Found[],
  insideBody = false,
  depth = 0,
  anywhere = false,
  underNonVend = false
): void {
  if (!answer || typeof answer !== 'object' || depth > MAX_DEPTH) {
    return;
  }
  const children = Array.isArray(answer)
    ? answer.map((item) => ['', item] as const)
    : Object.entries(answer);
  for (const [rawKey, value] of children) {
    const key = normaliseKey(rawKey);
    if ((insideBody || anywhere) && matches(key, insideBody, underNonVend)) {
      // An array value ("transactionReference": ["MFBP-1"]) is read item by item.
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === 'string' || typeof item === 'number') {
          const text = String(item).trim();
          if (text) {
            out.push({ depth, value: text });
          }
        }
      }
    }
    collectBodyField(
      value,
      matches,
      out,
      insideBody || key === 'responsebody',
      depth + 1,
      anywhere,
      underNonVend || NON_VEND_PARENT.test(key)
    );
  }
}

/**
 * Reference-like keys, the same shapes vend evidence reads: reference / ref /
 * a transaction, vend, order, payment or purchase id or number, a receipt or
 * invoice number. References we supplied (validation, request, customer) are
 * echoes, not evidence; an exact echo of the request reference is ignored by
 * value.
 */
const REFERENCE_LIKE_KEY =
  /(?:reference(?:no|number|id)?|ref|(?:transaction|txn|vend|order|payment|purchase)(?:id|number|no)|(?:receipt|invoice)(?:no|number|id)?)$/;
const ECHO_REFERENCE_PREFIX =
  /^(?:validation|request|customer|product|biller|item|service|package|plan|merchant|account|user|refund|reversal|settlement|callback|webhook|notification|chargeback|error|exception|auth|authentication|credential|login|access|oauth)/;

// A vendReference under refund/request/error/... is not the vend's requery key.
const isVendReferenceKey: KeyMatcher = (key, _insideBody, underNonVend) =>
  key === 'vendreference' && !underNonVend;
// A bare `reference` / `ref` counts too: an exact echo of our own request
// reference is excluded by value, so a foreign one is evidence.
// A bare `reference`/`ref` under customer/product/... describes that object
// (customer references are echoes), not a vend.
const NON_VEND_PARENT =
  /^(?:customer|validation|request|product|biller|item|service|package|plan|account|merchant|user|refund|reversal|settlement|callback|webhook|notification|chargeback|error|exception|auth|authentication|credential|login|access|oauth)s?$/;
const isProviderReferenceKey: KeyMatcher = (key, _insideBody, underNonVend) =>
  REFERENCE_LIKE_KEY.test(key) &&
  !ECHO_REFERENCE_PREFIX.test(key) &&
  !underNonVend;

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
  collectBodyField(answer, isVendReferenceKey, found);
  return pickShallowest(found);
}

/** Every transactionReference / vendReference the answer carries, at any level. */
export function collectMonnifyProviderReferences(answer: unknown): string[] {
  const found: Found[] = [];
  // Anywhere in the answer, top level included: a reference Monnify issued
  // means a vend may exist whichever object it sits in.
  collectBodyField(answer, isProviderReferenceKey, found, false, 0, true);
  return found.map((item) => item.value);
}

/**
 * Whether the answer carries a reference other than an exact echo of our own
 * request reference. Such a body means a vend may exist. Monnify issues a
 * transactionReference only for a transaction it created.
 */
export function hasMonnifyProviderReference(
  answer: unknown,
  requestReference: string
): boolean {
  return hasForeignMonnifyReference(
    collectMonnifyProviderReferences(answer),
    requestReference
  );
}

export function hasForeignMonnifyReference(
  references: string[],
  requestReference: string
): boolean {
  return references.some(
    (reference) =>
      reference.toLowerCase() !== requestReference.trim().toLowerCase()
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

/**
 * Keys are compared case-insensitively with "_" and "-" ignored, so
 * vend_reference, VendReference and vendReference all count.
 */
function normaliseKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

/**
 * Reference-like keys: any key ending in reference / ref / reference number,
 * or a transaction, vend, order or txn id (transactionReference,
 * vendReference, paymentReference, orderReference, referenceNumber,
 * transactionId…). Matching the shape, not a fixed list, fails closed on new
 * Monnify keys: an unknown reference blocks Kuda instead of being missed.
 */
const REFERENCE_LIKE_KEY =
  /(?:reference(?:no|number|id)?|ref|(?:transaction|txn|vend|order)id)$/;

/**
 * At the top level a bare `reference` or `requestReference` is usually an echo
 * of our own request, so only more specific references count there. Below
 * the top level (responseBody and anything nested in it) every
 * reference-like key counts.
 */
const TOP_LEVEL_ECHO_KEYS = new Set(['reference', 'requestreference']);

function isVendStatusKey(key: string): boolean {
  // A string status ("FAILED", "PENDING") is the vend's own status; a
  // numeric one is just an HTTP code and is ignored (isEvidenceValue).
  return key === 'vendstatus' || key === STATUS_KEY;
}

/**
 * References we supplied before the vend (validation, request or customer
 * references) are echoes, at any depth, never evidence of a vend.
 */
const ECHO_REFERENCE_PREFIX = /^(?:validation|request|customer)/;

function isVendReferenceKey(key: string): boolean {
  return REFERENCE_LIKE_KEY.test(key) && !ECHO_REFERENCE_PREFIX.test(key);
}

function isTopLevelEvidenceKey(key: string): boolean {
  return (
    isVendStatusKey(key) ||
    (isVendReferenceKey(key) && !TOP_LEVEL_ECHO_KEYS.has(key))
  );
}

function isNestedEvidenceKey(key: string): boolean {
  return isVendStatusKey(key) || isVendReferenceKey(key);
}

const STATUS_KEY = normaliseKey('status');
/**
 * HTTP reason phrases and generic error labels that error bodies put in a
 * `status` field. Any other non-numeric status (FAILED, PENDING, CANCELLED,
 * DECLINED, UNKNOWN…) is read as the vend's own state and fails closed.
 */
const HTTP_STATUS_LABEL =
  /^(?:errors?|ok|bad request|unauthori[sz]ed|forbidden|not found|method not allowed|not acceptable|request timeout|conflict|unprocessable entity|too many requests|internal server error|bad gateway|service unavailable|gateway timeout|invalid request|validation error)$/i;
const MAX_NESTED_DEPTH = 6;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEvidenceValue(key: string, value: unknown): boolean {
  // A numeric `status` (number or digit string such as "400") is an HTTP
  // code, never a vend status.
  // A generic `status` counts unless it is an HTTP reason phrase or error
  // label ("error", "Bad Request"): those only label the error body.
  if (key === STATUS_KEY) {
    if (typeof value !== 'string') {
      return false;
    }
    const label = value.replace(/[_-]+/g, ' ').trim();
    return /\D/.test(label) && !HTTP_STATUS_LABEL.test(label);
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  return typeof value === 'number';
}

function carriesVendField(
  record: Record<string, unknown>,
  isEvidenceKey: (key: string) => boolean
): boolean {
  return Object.entries(record).some(([rawKey, value]) => {
    const key = normaliseKey(rawKey);
    return isEvidenceKey(key) && isEvidenceValue(key, value);
  });
}

/** Searches every object nested below the top level (responseBody, data…). */
function nestedCarriesVendField(value: unknown, depth: number): boolean {
  if (depth > MAX_NESTED_DEPTH || !value || typeof value !== 'object') {
    return false;
  }
  const children = Array.isArray(value) ? value : [value];
  return children.some((child) => {
    const record = asRecord(child);
    if (!record) {
      return nestedCarriesVendField(child, depth + 1);
    }
    return (
      carriesVendField(record, isNestedEvidenceKey) ||
      Object.values(record).some((inner) =>
        nestedCarriesVendField(inner, depth + 1)
      )
    );
  });
}

/**
 * Whether a Monnify answer (a business envelope or a parsed HTTP error body)
 * carries any sign of a vend: a status or a reference, at the top level or
 * in any nested object (responseBody, responseBody.data…), in any key casing.
 * A rejection with such a sign may have reached the network, so it never
 * counts as a pre-vend refusal.
 */
export function hasMonnifyVendEvidence(answer: unknown): boolean {
  const record = asRecord(answer);
  if (!record) {
    return false;
  }
  return (
    carriesVendField(record, isTopLevelEvidenceKey) ||
    Object.values(record).some((value) => nestedCarriesVendField(value, 1))
  );
}

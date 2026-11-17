/**
 * Keys are compared case-insensitively with "_" and "-" ignored, so
 * vend_reference, VendReference and vendReference all count.
 */
function normaliseKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

/** Fields that show Monnify created or tracked a vend for this request. */
const MONNIFY_VEND_EVIDENCE_FIELDS = new Set(
  [
    'vendStatus',
    'transactionReference',
    'vendReference',
    'paymentReference',
    // A string status ("FAILED", "PENDING") is the vend's own status; a
    // numeric one is just an HTTP code and is ignored (isEvidenceValue).
    'status',
  ].map(normaliseKey)
);

/**
 * Below the top level (responseBody and anything nested in it) a plain
 * `reference` is Monnify's record. At the top level it is often just an echo
 * of our request reference, so it is not read there.
 */
const MONNIFY_RESPONSE_BODY_EVIDENCE_FIELDS = new Set([
  ...MONNIFY_VEND_EVIDENCE_FIELDS,
  normaliseKey('reference'),
]);

const STATUS_KEY = normaliseKey('status');
const VEND_STATUS_WORDS =
  /^(?:success(?:ful)?|completed?|delivered|vended|failed|failure|pending|processing|in[\s_-]?progress|queued|initiated|reversed|paid)$/i;
const MAX_NESTED_DEPTH = 6;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEvidenceValue(key: string, value: unknown): boolean {
  // A numeric `status` (number or digit string such as "400") is an HTTP
  // code, never a vend status.
  // A generic `status` counts only with vend-status wording; "error" or
  // "Bad Request" are just how the error body is labelled.
  if (key === STATUS_KEY) {
    return typeof value === 'string' && VEND_STATUS_WORDS.test(value.trim());
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  return typeof value === 'number';
}

function carriesVendField(
  record: Record<string, unknown>,
  fields: ReadonlySet<string>
): boolean {
  return Object.entries(record).some(([rawKey, value]) => {
    const key = normaliseKey(rawKey);
    return fields.has(key) && isEvidenceValue(key, value);
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
      carriesVendField(record, MONNIFY_RESPONSE_BODY_EVIDENCE_FIELDS) ||
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
    carriesVendField(record, MONNIFY_VEND_EVIDENCE_FIELDS) ||
    Object.values(record).some((value) => nestedCarriesVendField(value, 1))
  );
}

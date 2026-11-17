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
    'reference',
  ].map(normaliseKey)
);

/**
 * Inside responseBody a plain `status` is the vend's own status (the
 * classifier reads it as a fallback for vendStatus). At the top level it is
 * often just the HTTP status of an error body, so it is not read there.
 */
const MONNIFY_RESPONSE_BODY_EVIDENCE_FIELDS = new Set([
  ...MONNIFY_VEND_EVIDENCE_FIELDS,
  normaliseKey('status'),
]);

const RESPONSE_BODY_KEY = normaliseKey('responseBody');

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function carriesVendField(
  value: unknown,
  fields: ReadonlySet<string>
): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return Object.entries(record).some(
    ([key, fieldValue]) =>
      fields.has(normaliseKey(key)) &&
      ((typeof fieldValue === 'string' && fieldValue.trim() !== '') ||
        typeof fieldValue === 'number')
  );
}

/**
 * Whether a Monnify answer (a business envelope or a parsed HTTP error body)
 * carries any sign of a vend: a status or a reference, at the top level or in
 * its responseBody, in any key casing. A rejection with such a sign may have
 * reached the network, so it never counts as a pre-vend refusal.
 */
export function hasMonnifyVendEvidence(answer: unknown): boolean {
  const record = asRecord(answer);
  if (!record) {
    return false;
  }
  if (carriesVendField(record, MONNIFY_VEND_EVIDENCE_FIELDS)) {
    return true;
  }
  return Object.entries(record).some(
    ([key, body]) =>
      normaliseKey(key) === RESPONSE_BODY_KEY &&
      carriesVendField(body, MONNIFY_RESPONSE_BODY_EVIDENCE_FIELDS)
  );
}

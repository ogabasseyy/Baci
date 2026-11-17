/** Fields that show Monnify created or tracked a vend for this request. */
const MONNIFY_VEND_EVIDENCE_FIELDS = [
  'vendStatus',
  'transactionReference',
  'vendReference',
  'paymentReference',
] as const;

/**
 * Inside responseBody a plain `status` is the vend's own status (the
 * classifier reads it as a fallback for vendStatus). At the top level it is
 * often just the HTTP status of an error body, so it is not read there.
 */
const MONNIFY_RESPONSE_BODY_EVIDENCE_FIELDS = [
  ...MONNIFY_VEND_EVIDENCE_FIELDS,
  'status',
] as const;

function carriesVendField(
  value: unknown,
  fields: readonly string[] = MONNIFY_VEND_EVIDENCE_FIELDS
): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return fields.some((field) => {
    const value = record[field];
    return (
      (typeof value === 'string' && value.trim() !== '') ||
      typeof value === 'number'
    );
  });
}

/**
 * Whether a Monnify answer (a business envelope or a parsed HTTP error body)
 * carries any sign of a vend: a status or a reference, at the top level or in
 * its responseBody. A rejection with such a sign may have reached the
 * network, so it never counts as a pre-vend refusal.
 */
export function hasMonnifyVendEvidence(answer: unknown): boolean {
  if (!answer || typeof answer !== 'object') {
    return false;
  }
  return (
    carriesVendField(answer) ||
    carriesVendField(
      (answer as Record<string, unknown>).responseBody,
      MONNIFY_RESPONSE_BODY_EVIDENCE_FIELDS
    )
  );
}

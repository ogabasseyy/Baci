/** Fields that show Monnify created or tracked a vend for this request. */
const MONNIFY_VEND_EVIDENCE_FIELDS = [
  'vendStatus',
  'transactionReference',
  'vendReference',
] as const;

function carriesVendField(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return MONNIFY_VEND_EVIDENCE_FIELDS.some((field) => {
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
    carriesVendField((answer as Record<string, unknown>).responseBody)
  );
}

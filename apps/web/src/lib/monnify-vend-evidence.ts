/** Fields that show Monnify created or tracked a vend for this request. */
const MONNIFY_VEND_EVIDENCE_FIELDS = [
  'vendStatus',
  'transactionReference',
  'vendReference',
] as const;

/**
 * Whether a Monnify envelope's body carries any sign of a vend (a status or a
 * reference). A rejection with such a body may have reached the network, so
 * it never counts as a pre-vend refusal.
 */
export function hasMonnifyVendEvidence(envelope: unknown): boolean {
  if (!envelope || typeof envelope !== 'object') {
    return false;
  }
  const body = (envelope as Record<string, unknown>).responseBody;
  if (!body || typeof body !== 'object') {
    return false;
  }
  const record = body as Record<string, unknown>;
  return MONNIFY_VEND_EVIDENCE_FIELDS.some((field) => {
    const value = record[field];
    return (
      (typeof value === 'string' && value.trim() !== '') ||
      typeof value === 'number'
    );
  });
}

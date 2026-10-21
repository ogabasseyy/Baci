/**
 * Finite numeric coercion: null/undefined/'' stay null (Number(null)
 * and Number('') are 0 — an unpriced row must stay null rather than
 * pricing checks at zero); non-finite results stay null.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

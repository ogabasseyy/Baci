import { pickString } from './loose-schemas';

/**
 * Pure helpers for proof 8: which destination-side row belongs to OUR
 * transfer, and which provider ids the destination record shares with the
 * source-side TSQ record. Only field NAMES leave these helpers.
 */

export interface DestinationRowMatch {
  row: Record<string, unknown> | null;
  matchedBy: 'reference' | 'amount' | 'none';
  /** More than one new credit row of the amount, and none carrying our reference. */
  ambiguous: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Rows listed before the transfer never count. A row carrying our reference
 * wins; otherwise exactly one new credit row of the amount that carries no
 * other reference is accepted, and
 * two or more are ambiguous (no row is guessed).
 */
export function selectDestinationRow(
  edges: unknown[],
  expected: {
    reference: string;
    amountKobo: number;
    excludeIds: ReadonlySet<string>;
  }
): DestinationRowMatch {
  const fresh = edges.filter(isRecord).filter((edge) => {
    const id = pickString(edge, ['id']);
    return !(id && expected.excludeIds.has(id));
  });
  const byReference = fresh.find(
    (edge) => pickString(edge, ['third_party_reference']) === expected.reference
  );
  if (byReference)
    return { row: byReference, matchedBy: 'reference', ambiguous: false };
  const byAmount = fresh.filter(
    (edge) =>
      pickString(edge, ['type']) === 'credit' &&
      edge.amount === expected.amountKobo &&
      // A row naming a different transfer is never ours; keep polling.
      !(pickString(edge, ['third_party_reference']) ?? '')
  );
  if (byAmount.length === 1)
    return { row: byAmount[0], matchedBy: 'amount', ambiguous: false };
  return { row: null, matchedBy: 'none', ambiguous: byAmount.length > 1 };
}

const ID_FIELDS = [
  'id',
  'reference',
  'internal_reference',
  'session_id',
  'third_party_reference',
] as const;

/** The id-like fields both records hold with the same non-empty string. */
export function sharedIdFields(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null
): string[] | null {
  if (!a || !b) return null;
  return ID_FIELDS.filter((key) => {
    const value = a[key];
    return typeof value === 'string' && value !== '' && value === b[key];
  });
}

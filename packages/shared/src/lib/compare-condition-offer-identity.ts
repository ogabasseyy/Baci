import type { ConditionOfferLike } from './eligible-condition-offers';

/**
 * Code-unit string order: locale-independent, unlike localeCompare
 * (whose punctuation/case handling varies by ICU build and never
 * matches Postgres byte order for uuids).
 */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Canonical-condition fallback order: raw condition, then id — the
 * storefront RPC's (condition, id) emission order. The feed dedup and
 * the PDP condition selector both sort by this comparator, so the
 * first row per normalized condition is the same row the PDP would
 * select, regardless of source order. Ids compare as lowercase hex
 * (uuid byte order); conditions compare raw, matching the SQL text
 * order for the lowercase condition vocabulary.
 */
export function compareConditionOfferIdentity(
  a: Pick<ConditionOfferLike, 'id' | 'condition'>,
  b: Pick<ConditionOfferLike, 'id' | 'condition'>
): number {
  const conditionOrder = compareCodeUnits(
    String(a.condition ?? ''),
    String(b.condition ?? '')
  );
  if (conditionOrder !== 0) return conditionOrder;
  return compareCodeUnits(
    String(a.id ?? '').toLowerCase(),
    String(b.id ?? '').toLowerCase()
  );
}

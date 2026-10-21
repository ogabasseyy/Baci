import { toGoogleListingCondition } from './product-condition';

/** Structural offer shape shared by every feed consumer. */
export interface ConditionOfferLike {
  id?: unknown;
  price?: unknown;
  condition?: unknown;
  images?: unknown;
}

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

/**
 * Offers that can emit feed rows: identified, positive finite price, valid
 * condition, and different from the parent condition. A null parent
 * defaults to `new`, matching the storefront PDP selection rule that never
 * purchases through a same-condition offer. Every feed consumer and the
 * backfill must build image claims from this list so non-emittable offers
 * can neither claim imagery nor emit rows.
 */
export function getEligibleConditionOffers<T extends ConditionOfferLike>(
  offers: readonly T[] | undefined,
  parentCondition: string | null | undefined
): T[] {
  // A null parent defaults to `new`, matching the storefront PDP rule;
  // anything else must map cleanly or the parent contributes no condition.
  const parent =
    parentCondition == null ? 'new' : toGoogleListingCondition(parentCondition);
  // Order deterministically by the shared (condition, id) comparator
  // before deduplicating: the first offer per normalized condition must
  // be the same row the PDP would select, regardless of source order.
  const ordered = [...(offers ?? [])].sort(compareConditionOfferIdentity);
  // The storefront selects the first offer matching a normalized
  // condition, so duplicate normalized conditions would land at least
  // one row on the wrong purchasable price: keep the first only.
  const seen = new Set<string>();
  return ordered.filter((offer) => {
    const price = Number(offer.price);
    const condition = toGoogleListingCondition(
      offer.condition as string | null | undefined
    );
    if (
      !offer.id ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !condition ||
      condition === parent ||
      seen.has(condition)
    ) {
      return false;
    }
    seen.add(condition);
    return true;
  });
}

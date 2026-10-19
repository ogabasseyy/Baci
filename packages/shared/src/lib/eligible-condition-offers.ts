import { toGoogleListingCondition } from './product-condition';

/** Structural offer shape shared by every feed consumer. */
export interface ConditionOfferLike {
  id?: unknown;
  price?: unknown;
  condition?: unknown;
  images?: unknown;
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
  // Order deterministically by (condition, id) like the storefront RPC
  // before deduplicating: the first offer per normalized condition must
  // be the same row the PDP would select, regardless of source order.
  const ordered = [...(offers ?? [])].sort((a, b) => {
    const conditionOrder = String(a.condition ?? '').localeCompare(
      String(b.condition ?? '')
    );
    if (conditionOrder !== 0) return conditionOrder;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
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

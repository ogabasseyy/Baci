import { toGoogleListingCondition } from '@baci/shared/lib';

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
 * condition defaults to `new`, matching the storefront PDP selection rule
 * that never purchases through a same-condition offer. Every feed consumer
 * must build image claims from this list so non-emittable offers can
 * neither claim imagery nor emit rows.
 */
export function getEligibleConditionOffers<T extends ConditionOfferLike>(
  offers: ReadonlyArray<T> | undefined,
  parentCondition: string | null | undefined
): T[] {
  // A null parent defaults to `new`, matching the storefront PDP rule;
  // anything else must map cleanly or the parent contributes no condition.
  const parent =
    parentCondition == null ? 'new' : toGoogleListingCondition(parentCondition);
  return (offers ?? []).filter((offer) => {
    const price = Number(offer.price);
    const condition = toGoogleListingCondition(
      offer.condition as string | null | undefined
    );
    return (
      !!offer.id &&
      Number.isFinite(price) &&
      price > 0 &&
      !!condition &&
      condition !== parent
    );
  });
}

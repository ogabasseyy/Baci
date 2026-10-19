type OfferIdentityLike = { id: string };

/**
 * Honored route offer id: the link param names one of the product's own
 * hydrated offers and the shopper has not explicitly picked past it.
 */
export function matchRouteOfferId(
  offerIdParam: string | null | undefined,
  ignoredRouteOfferId: string | null,
  offers: OfferIdentityLike[] | undefined
): string | null {
  return offerIdParam &&
    offerIdParam !== ignoredRouteOfferId &&
    offers?.some((offer) => String(offer.id) === offerIdParam)
    ? offerIdParam
    : null;
}

/**
 * Exact-match contract (mirrors native route data): a nonempty link offer
 * id absent from the hydrated offers means the offer was removed,
 * deactivated, or sold — surface it as missing instead of silently
 * falling back to the parent/default price. An explicit shopper pick
 * (ignoredRouteOfferId) clears the missing state: they deliberately
 * moved past the dead link. Only hydrated offer arrays count, so a
 * product that never loads offers keeps the legacy silent path.
 */
export function isRouteOfferMissing(
  offerIdParam: string | null | undefined,
  ignoredRouteOfferId: string | null,
  offers: OfferIdentityLike[] | undefined
): boolean {
  return (
    Boolean(offerIdParam) &&
    offerIdParam !== ignoredRouteOfferId &&
    Array.isArray(offers) &&
    !offers.some((offer) => String(offer.id) === offerIdParam)
  );
}

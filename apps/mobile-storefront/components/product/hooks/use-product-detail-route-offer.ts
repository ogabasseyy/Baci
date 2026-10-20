import type { Product, ProductConditionOffer } from '@/types/product';

type RouteOfferProduct = Pick<
  Product,
  'has_condition_offers' | 'offers' | 'offers_hydration_failed'
>;

export type RouteOfferState = {
  routeOfferId: string | null;
  routeOfferHydrationFailed: boolean;
  routeOfferHydrationPending: boolean;
  routeOfferHydrationError: string | null;
};

/**
 * Exact-match contract for offer_id links. Search/compare entry points
 * forward the advertised matched offer id; accept it only when it names
 * one of this product's own offers on a product that actually carries
 * condition offers with a live hydration: a failed offer fetch preserves
 * the row's prior offers array, so an id match alone would accept a
 * stale identity and skip the retry error path.
 */
export function resolveRouteOfferState({
  product,
  routeOfferIdParam,
  routeOfferRow,
}: {
  product: RouteOfferProduct | null | undefined;
  routeOfferIdParam: string | undefined;
  routeOfferRow: ProductConditionOffer | undefined;
}): RouteOfferState {
  const routeOfferId =
    routeOfferIdParam &&
    product?.has_condition_offers === true &&
    product?.offers_hydration_failed !== true &&
    routeOfferRow != null
      ? routeOfferIdParam
      : null;
  // An exact offer link whose offer fetch failed must not render as an
  // offerless product: the requested identity would be silently dropped
  // and the shopper could add a different price/condition than opened.
  // Surface the existing error path (retry via refetch) instead.
  const routeOfferHydrationFailed =
    routeOfferIdParam != null &&
    routeOfferIdParam.length > 0 &&
    product?.offers_hydration_failed === true;
  // Exact-match contract, second half: when offers hydrated successfully but
  // the link's offer id is absent (removed or sold), the offer is unavailable
  // — falling back to the parent default would silently advertise a live
  // price for a dead link.
  const routeOfferMissingFromHydratedOffers =
    routeOfferIdParam != null &&
    routeOfferIdParam.length > 0 &&
    product?.offers_hydration_failed !== true &&
    product != null &&
    (product.has_condition_offers !== true ||
      (Array.isArray(product.offers) && routeOfferRow == null));
  // Exact-link hydration pending: cached initial rows omit `offers`, so an
  // exact offer_id opens with routeOfferId null while the detail refetch
  // runs. Neither missing nor failed fires in that window, which would
  // render an enabled parent-price purchase path for the advertised offer
  // link. Block purchase until offers resolve (then missing/failed or the
  // matched offer takes over).
  const routeOfferHydrationPending =
    routeOfferIdParam != null &&
    routeOfferIdParam.length > 0 &&
    product != null &&
    product.has_condition_offers === true &&
    product.offers_hydration_failed !== true &&
    !Array.isArray(product.offers);
  const routeOfferUnavailable =
    routeOfferHydrationFailed || routeOfferMissingFromHydratedOffers;
  const routeOfferHydrationError = routeOfferUnavailable
    ? routeOfferMissingFromHydratedOffers
      ? 'This offer is no longer available. It may have been removed or sold.'
      : 'This offer could not be loaded. Check your connection and try again.'
    : null;
  return {
    routeOfferHydrationError,
    routeOfferHydrationFailed,
    routeOfferHydrationPending,
    routeOfferId,
  };
}

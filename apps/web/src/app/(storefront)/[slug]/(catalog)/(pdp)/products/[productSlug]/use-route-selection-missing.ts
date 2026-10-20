import { useState } from 'react';

import type { Product } from '@/lib/products';
import {
  isRouteOfferMissing,
  matchRouteOfferId,
} from './resolve-route-offer-match';
import { isRouteVariantMissing } from './resolve-route-variant-match';

interface RouteSelectionMissingInput {
  offerIdParam: string | null | undefined;
  product: Product;
  routeSeedKey: string;
  routeVariantId: string | null | undefined;
}

/**
 * Route-entry missing/offer state for the PDP: search/compare entry points
 * forward the advertised matched offer or variant id. It is honored only
 * when it names one of this product's own offers/variants; dead ids surface
 * as missing instead of silently rendering the default, and any explicit
 * shopper pick ignores the route id. Ignore state reseeds with the route
 * seed key so a new deep link starts fresh.
 */
export function useRouteSelectionMissing({
  offerIdParam,
  product,
  routeSeedKey,
  routeVariantId,
}: RouteSelectionMissingInput) {
  const [ignoredRouteOfferId, setIgnoredRouteOfferId] = useState<string | null>(
    null
  );
  const [ignoredRouteBaseMatch, setIgnoredRouteBaseMatch] = useState(false);
  const [ignoredRouteVariantId, setIgnoredRouteVariantId] = useState<
    string | null
  >(null);

  const routeOfferId = matchRouteOfferId(
    offerIdParam,
    ignoredRouteOfferId,
    product.offers
  );
  const routeOfferMissing = isRouteOfferMissing(
    offerIdParam,
    ignoredRouteOfferId,
    product.offers
  );
  const routeVariantMissing = isRouteVariantMissing(
    routeVariantId,
    ignoredRouteVariantId,
    product.variants
  );

  // Reseed inline during render (same "adjust state when a prop changes"
  // pattern as the selection seeding): a new route entry link starts with
  // no ignores instead of inheriting the previous link's.
  const [prevRouteSeedKey, setPrevRouteSeedKey] = useState<string | null>(null);
  if (routeSeedKey !== prevRouteSeedKey) {
    setPrevRouteSeedKey(routeSeedKey);
    setIgnoredRouteOfferId(null);
    setIgnoredRouteBaseMatch(false);
    setIgnoredRouteVariantId(null);
  }

  return {
    ignoredRouteBaseMatch,
    ignoredRouteOfferId,
    routeOfferId,
    routeOfferMissing,
    routeVariantMissing,
    setIgnoredRouteBaseMatch,
    setIgnoredRouteOfferId,
    setIgnoredRouteVariantId,
  };
}

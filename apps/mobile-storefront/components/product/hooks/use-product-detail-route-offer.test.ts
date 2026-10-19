import { describe, expect, it } from '@jest/globals';
import type { ProductConditionOffer } from '@/types/product';
import { resolveRouteOfferState } from './use-product-detail-route-offer';

const offer = { id: 'offer-1' } as ProductConditionOffer;

describe('resolveRouteOfferState', () => {
  it('accepts an exact offer link on hydrated condition offers', () => {
    expect(
      resolveRouteOfferState({
        product: {
          has_condition_offers: true,
          offers: [offer],
          offers_hydration_failed: false,
        },
        routeOfferIdParam: 'offer-1',
        routeOfferRow: offer,
      })
    ).toEqual({
      routeOfferHydrationError: null,
      routeOfferHydrationFailed: false,
      routeOfferHydrationPending: false,
      routeOfferId: 'offer-1',
    });
  });

  it('rejects the link when the offer fetch failed, preserving the retry path', () => {
    expect(
      resolveRouteOfferState({
        product: {
          has_condition_offers: true,
          offers: [offer],
          offers_hydration_failed: true,
        },
        routeOfferIdParam: 'offer-1',
        routeOfferRow: offer,
      })
    ).toMatchObject({
      routeOfferHydrationError:
        'This offer could not be loaded. Check your connection and try again.',
      routeOfferHydrationFailed: true,
      routeOfferId: null,
    });
  });

  it('reports a missing link as unavailable once offers hydrate', () => {
    expect(
      resolveRouteOfferState({
        product: {
          has_condition_offers: true,
          offers: [],
          offers_hydration_failed: false,
        },
        routeOfferIdParam: 'offer-gone',
        routeOfferRow: undefined,
      })
    ).toMatchObject({
      routeOfferHydrationError:
        'This offer is no longer available. It may have been removed or sold.',
      routeOfferHydrationFailed: false,
      routeOfferId: null,
    });
  });

  it('blocks purchase while cached rows omit offers', () => {
    expect(
      resolveRouteOfferState({
        product: {
          has_condition_offers: true,
          offers: undefined,
          offers_hydration_failed: false,
        },
        routeOfferIdParam: 'offer-1',
        routeOfferRow: undefined,
      })
    ).toMatchObject({
      routeOfferHydrationError: null,
      routeOfferHydrationPending: true,
      routeOfferId: null,
    });
  });

  it('ignores the param on products without condition offers', () => {
    expect(
      resolveRouteOfferState({
        product: {
          has_condition_offers: false,
          offers: [],
          offers_hydration_failed: false,
        },
        routeOfferIdParam: 'offer-1',
        routeOfferRow: undefined,
      })
    ).toMatchObject({
      routeOfferHydrationPending: false,
      routeOfferId: null,
    });
  });
});

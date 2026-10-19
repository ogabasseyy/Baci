import { describe, expect, it } from 'vitest';
import {
  resolveCriticalRouteOffer,
  seedCriticalRouteOfferCondition,
} from './critical-route-offer';

const offers = [
  { id: 'offer-new', condition: 'new', price: 100 },
  { id: 'offer-used', condition: 'used', price: 60 },
];

describe('resolveCriticalRouteOffer', () => {
  it('resolves a link offer id to the matched offer and condition', () => {
    expect(
      resolveCriticalRouteOffer({
        offers,
        searchParams: { offer_id: 'offer-used' },
      })
    ).toEqual({
      offerId: 'offer-used',
      offerCondition: 'used',
      offerPrice: 60,
      missing: false,
    });
  });

  it('marks a nonempty unknown offer id as missing', () => {
    expect(
      resolveCriticalRouteOffer({
        offers,
        searchParams: { offer_id: 'offer-gone' },
      })
    ).toEqual({
      offerId: null,
      offerCondition: null,
      offerPrice: null,
      missing: true,
    });
  });

  it('returns no offer and no missing state without the param', () => {
    expect(resolveCriticalRouteOffer({ offers, searchParams: {} })).toEqual({
      offerId: null,
      offerCondition: null,
      offerPrice: null,
      missing: false,
    });
    expect(
      resolveCriticalRouteOffer({ offers, searchParams: { offer_id: '' } })
    ).toEqual({
      offerId: null,
      offerCondition: null,
      offerPrice: null,
      missing: false,
    });
  });

  it('reads the first value of a repeated param', () => {
    expect(
      resolveCriticalRouteOffer({
        offers,
        searchParams: { offer_id: ['offer-new', 'offer-used'] },
      })
    ).toEqual({
      offerId: 'offer-new',
      offerCondition: 'new',
      offerPrice: 100,
      missing: false,
    });
  });

  it('cannot judge missing without hydrated offers', () => {
    expect(
      resolveCriticalRouteOffer({
        offers: null,
        searchParams: { offer_id: 'offer-used' },
      })
    ).toEqual({
      offerId: null,
      offerCondition: null,
      offerPrice: null,
      missing: false,
    });
  });
});

describe('seedCriticalRouteOfferCondition', () => {
  const routeOffer = {
    offerId: 'offer-used',
    offerCondition: 'used',
    offerPrice: 60,
    missing: false,
  };

  it('seeds the offer condition when no explicit condition exists', () => {
    expect(seedCriticalRouteOfferCondition(undefined, routeOffer)).toEqual({
      condition: 'used',
    });
    expect(
      seedCriticalRouteOfferCondition({ variantId: 'v1' }, routeOffer)
    ).toEqual({ variantId: 'v1', condition: 'used' });
  });

  it('never overrides an explicit condition', () => {
    const selection = { condition: 'new' };
    expect(seedCriticalRouteOfferCondition(selection, routeOffer)).toBe(
      selection
    );
  });

  it('leaves the selection alone without a matched offer', () => {
    expect(
      seedCriticalRouteOfferCondition(undefined, {
        offerId: null,
        offerCondition: null,
        offerPrice: null,
        missing: true,
      })
    ).toBeUndefined();
  });
});

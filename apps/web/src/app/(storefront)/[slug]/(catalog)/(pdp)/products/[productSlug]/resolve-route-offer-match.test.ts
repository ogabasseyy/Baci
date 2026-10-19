import { describe, expect, it } from 'vitest';
import {
  isRouteOfferMissing,
  matchRouteOfferId,
} from './resolve-route-offer-match';

const offers = [{ id: 'o1' }, { id: 'o2' }];

describe('matchRouteOfferId', () => {
  it('honors a live link id until the shopper picks past it', () => {
    expect(matchRouteOfferId('o1', null, offers)).toBe('o1');
    expect(matchRouteOfferId('o1', 'o1', offers)).toBeNull();
    expect(matchRouteOfferId('nope', null, offers)).toBeNull();
    expect(matchRouteOfferId(null, null, offers)).toBeNull();
  });
});

describe('isRouteOfferMissing', () => {
  it('flags a nonempty link id absent from hydrated offers', () => {
    expect(isRouteOfferMissing('nope', null, offers)).toBe(true);
  });

  it('stays clear for live, absent, ignored, and unhydrated links', () => {
    expect(isRouteOfferMissing('o1', null, offers)).toBe(false);
    expect(isRouteOfferMissing(null, null, offers)).toBe(false);
    expect(isRouteOfferMissing('', null, offers)).toBe(false);
    expect(isRouteOfferMissing('nope', 'nope', offers)).toBe(false);
    expect(isRouteOfferMissing('nope', null, undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  compareConditionOfferIdentity,
  getEligibleConditionOffers,
} from './eligible-condition-offers';

describe('getEligibleConditionOffers', () => {
  it('keeps identified, positively priced, valid-condition offers', () => {
    const offers = [
      { id: 'o1', price: 100, condition: 'used' },
      { id: 'o2', price: 200, condition: 'refurbished' },
    ];
    expect(
      getEligibleConditionOffers(offers, 'new').map((offer) => offer.id)
    ).toEqual(['o2', 'o1']);
  });

  it('drops offers without id, price, or mappable condition', () => {
    const offers = [
      { price: 100, condition: 'used' },
      { id: 'o2', price: 0, condition: 'used' },
      { id: 'o3', price: 100, condition: 'mystery' },
      { id: 'o4', price: 100, condition: 'used' },
    ];
    expect(
      getEligibleConditionOffers(offers, 'new').map((offer) => offer.id)
    ).toEqual(['o4']);
  });

  it('excludes same-condition offers and defaults a null parent to new', () => {
    const offers = [
      { id: 'o1', price: 100, condition: 'new' },
      { id: 'o2', price: 100, condition: 'used' },
    ];
    expect(
      getEligibleConditionOffers(offers, 'new').map((offer) => offer.id)
    ).toEqual(['o2']);
    expect(
      getEligibleConditionOffers(offers, null).map((offer) => offer.id)
    ).toEqual(['o2']);
  });

  it('keeps the first offer per normalized condition', () => {
    const offers = [
      { id: 'o1', price: 100, condition: 'used' },
      { id: 'o2', price: 50, condition: 'open_box' },
      { id: 'o3', price: 75, condition: 'uk_used' },
    ];
    // uk_used normalizes to used like o1, so o1 is dropped as a duplicate
    // while open_box maps to refurbished and survives.
    expect(
      getEligibleConditionOffers(offers, 'new').map((offer) => offer.id)
    ).toEqual(['o2', 'o3']);
  });

  it('returns an empty list for missing offers', () => {
    expect(getEligibleConditionOffers(undefined, 'new')).toEqual([]);
  });
});

describe('compareConditionOfferIdentity', () => {
  it('orders by raw condition, then id, in code units', () => {
    // Hyphen sorts before underscore in code units ('-' < '_');
    // localeCompare may ignore or reorder punctuation by locale.
    expect(
      compareConditionOfferIdentity(
        { condition: 'a-b', id: 'x' },
        { condition: 'a_b', id: 'x' }
      )
    ).toBeLessThan(0);
    expect(
      compareConditionOfferIdentity(
        { condition: 'open_box', id: 'offer-zzz' },
        { condition: 'refurbished', id: 'offer-aaa' }
      )
    ).toBeLessThan(0);
    expect(
      compareConditionOfferIdentity(
        { condition: 'used', id: 'offer-aaa' },
        { condition: 'used', id: 'offer-zzz' }
      )
    ).toBeLessThan(0);
  });

  it('compares ids as lowercase hex, matching uuid byte order', () => {
    expect(compareConditionOfferIdentity({ id: 'AAA' }, { id: 'aaa' })).toBe(0);
    expect(
      compareConditionOfferIdentity(
        { id: '00000000-0000-4000-8000-00000000000A' },
        { id: '00000000-0000-4000-8000-00000000000a' }
      )
    ).toBe(0);
    expect(
      compareConditionOfferIdentity(
        { id: '00000000-0000-4000-8000-000000000009' },
        { id: '00000000-0000-4000-8000-00000000000A' }
      )
    ).toBeLessThan(0);
  });
});

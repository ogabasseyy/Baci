import { describe, expect, it } from 'vitest';
import { getEligibleConditionOffers } from './eligible-condition-offers';

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

import { describe, expect, it } from 'vitest';
import { getEligibleConditionOffers } from '@/lib/eligible-condition-offers';

describe('getEligibleConditionOffers', () => {
  it('keeps offers with valid id, price, and condition', () => {
    expect(
      getEligibleConditionOffers(
        [{ id: 'o1', price: 100, condition: 'used', images: [] }],
        'new'
      )
    ).toEqual([{ id: 'o1', price: 100, condition: 'used', images: [] }]);
  });

  it('drops offers without id, price, or valid condition', () => {
    expect(
      getEligibleConditionOffers(
        [
          { price: 100, condition: 'used' },
          { id: 'o2', price: 0, condition: 'used' },
          { id: 'o3', price: Number.NaN, condition: 'used' },
          { id: 'o4', price: 100, condition: 'bogus' },
        ],
        'new'
      )
    ).toEqual([]);
  });

  it('drops offers duplicating the parent condition', () => {
    expect(
      getEligibleConditionOffers(
        [{ id: 'o1', price: 100, condition: 'new' }],
        'new'
      )
    ).toEqual([]);
  });

  it('defaults a null parent condition to new', () => {
    expect(
      getEligibleConditionOffers(
        [
          { id: 'o1', price: 100, condition: 'new' },
          { id: 'o2', price: 100, condition: 'used' },
        ],
        null
      )
    ).toEqual([{ id: 'o2', price: 100, condition: 'used' }]);
  });

  it('returns an empty list without offers', () => {
    expect(getEligibleConditionOffers(undefined, 'new')).toEqual([]);
    expect(getEligibleConditionOffers([], 'new')).toEqual([]);
  });

  it('keeps only the first offer per normalized condition', () => {
    expect(
      getEligibleConditionOffers(
        [
          { id: 'o1', price: 100, condition: 'open_box' },
          { id: 'o2', price: 90, condition: 'refurbished' },
          { id: 'o3', price: 80, condition: 'used' },
        ],
        'new'
      )
    ).toEqual([
      { id: 'o1', price: 100, condition: 'open_box' },
      { id: 'o3', price: 80, condition: 'used' },
    ]);
  });
});

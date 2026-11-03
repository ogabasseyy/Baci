import { describe, expect, it } from 'vitest';
import { getCuratedPriceBands } from './price-band-taxonomy';

describe('getCuratedPriceBands', () => {
  it('returns configured bands when currency is NGN', () => {
    expect(
      getCuratedPriceBands('gaming-laptops', { merchantCurrency: 'NGN' })
    ).toHaveLength(3);
    expect(
      getCuratedPriceBands('audio', { merchantCurrency: 'ngn' })
    ).toHaveLength(3);
  });

  it('suppresses new-category bands when merchant currency is non-NGN or options omitted', () => {
    expect(getCuratedPriceBands('gaming-laptops')).toEqual([]);
    expect(getCuratedPriceBands('audio')).toEqual([]);
    expect(
      getCuratedPriceBands('gaming-laptops', { merchantCurrency: 'USD' })
    ).toEqual([]);
    expect(
      getCuratedPriceBands('tablets', { merchantCurrency: 'GBP' })
    ).toEqual([]);
    expect(getCuratedPriceBands('audio', { merchantCurrency: null })).toEqual(
      []
    );
    expect(
      getCuratedPriceBands('smartwatches', { merchantCurrency: undefined })
    ).toEqual([]);
    expect(
      getCuratedPriceBands('playstation-5', { merchantCurrency: 'EUR' })
    ).toEqual([]);
  });

  it('allows legacy categories even when merchant currency is non-NGN', () => {
    expect(
      getCuratedPriceBands('smartphones', { merchantCurrency: 'USD' })
    ).toHaveLength(2);
    expect(
      getCuratedPriceBands('laptops', { merchantCurrency: 'EUR' })
    ).toHaveLength(1);
    expect(
      getCuratedPriceBands('smart-tvs', { merchantCurrency: null })
    ).toHaveLength(1);
  });

  it('returns empty array for unknown categories', () => {
    expect(getCuratedPriceBands('unknown-category')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CURATED_PRICE_BANDS,
  getConfiguredPriceBands,
} from './get-configured-price-bands';

describe('getConfiguredPriceBands', () => {
  it('returns configured price bands for known categories', () => {
    const categories = Object.keys(CURATED_PRICE_BANDS);
    expect(categories).toEqual(
      expect.arrayContaining([
        'smartphones',
        'laptops',
        'smart-tvs',
        'gaming-laptops',
        'tablets',
        'audio',
        'smartwatches',
        'playstation-5',
      ])
    );

    for (const category of categories) {
      const taxonomyBands = getConfiguredPriceBands(category);
      expect(taxonomyBands.length).toBeGreaterThan(0);
      for (const band of taxonomyBands) {
        expect(band.slug).toMatch(/^under-[a-z0-9-]+$/);
        expect(band.ceiling).toBeGreaterThan(0);
        expect(band.label).toContain('Under ₦');
      }
    }
  });

  it('returns empty array for an unconfigured category', () => {
    expect(getConfiguredPriceBands('unknown-category')).toEqual([]);
  });

  it('returns empty array for prototype property names and does not throw', () => {
    expect(getConfiguredPriceBands('constructor')).toEqual([]);
    expect(getConfiguredPriceBands('toString')).toEqual([]);
    expect(getConfiguredPriceBands('hasOwnProperty')).toEqual([]);
  });
});

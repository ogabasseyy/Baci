import { describe, expect, it } from 'vitest';
import { buildPriceBandCandidate } from './compare-eligibility';

describe('compare eligibility candidate builders', () => {
  it('applies the price-band floor when selecting products and brand diversity', () => {
    expect(
      buildPriceBandCandidate({
        categorySlug: 'smartphones',
        band: {
          slug: 'mid-range',
          label: 'Mid-range Smartphones',
          floor: 300000,
          ceiling: 700000,
        },
        products: [
          {
            slug: 'below-floor-samsung',
            name: 'Below Floor Samsung',
            brand: 'Samsung',
            price: 250000,
          },
          {
            slug: 'in-band-apple-1',
            name: 'In Band Apple 1',
            brand: 'Apple',
            price: 350000,
          },
          {
            slug: 'in-band-apple-2',
            name: 'In Band Apple 2',
            brand: 'apple',
            price: 450000,
          },
          {
            slug: 'in-band-samsung-1',
            name: 'In Band Samsung 1',
            brand: 'Samsung',
            price: 500000,
          },
          {
            slug: 'in-band-samsung-2',
            name: 'In Band Samsung 2',
            brand: 'samsung',
            price: 650000,
          },
          {
            slug: 'above-ceiling-xiaomi',
            name: 'Above Ceiling Xiaomi',
            brand: 'Xiaomi',
            price: 750000,
          },
        ],
      })
    ).toMatchObject({
      activeProductCount: 4,
      differentiatingSpecCount: 2,
      isIndexable: false,
    });
  });
});

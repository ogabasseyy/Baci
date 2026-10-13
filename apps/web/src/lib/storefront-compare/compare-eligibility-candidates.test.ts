import { describe, expect, it } from 'vitest';
import {
  buildBrandCompareCandidate,
  buildPriceBandCandidate,
} from './compare-eligibility';
import { CURATED_PRICE_BANDS } from './price-band-taxonomy';

describe('compare eligibility candidate builders', () => {
  it('derives a single canonical brand-compare candidate from category products', () => {
    expect(
      buildBrandCompareCandidate({
        categorySlug: 'smartphones',
        products: [
          {
            slug: 'iphone-17-pro-max',
            name: 'iPhone 17 Pro Max',
            brand: 'Apple',
            price: 2100000,
          },
          {
            slug: 'iphone-17',
            name: 'iPhone 17',
            brand: 'Apple',
            price: 1500000,
          },
          {
            slug: 'iphone-16',
            name: 'iPhone 16',
            brand: 'Apple',
            price: 1250000,
          },
          {
            slug: 'samsung-galaxy-z-trifold',
            name: 'Samsung Galaxy Z TriFold',
            brand: 'Samsung',
            price: 7150000,
          },
          {
            slug: 'galaxy-s26-ultra',
            name: 'Galaxy S26 Ultra',
            brand: 'Samsung',
            price: 2500000,
          },
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'Samsung',
            price: 480000,
          },
        ],
      })
    ).toMatchObject({
      leftBrand: 'Apple',
      rightBrand: 'Samsung',
      isIndexable: true,
    });
  });

  it('normalizes brand keys before counting brand-compare candidates', () => {
    expect(
      buildBrandCompareCandidate({
        categorySlug: 'smartphones',
        products: [
          {
            slug: 'iphone-17-pro-max',
            name: 'iPhone 17 Pro Max',
            brand: 'Apple',
            price: 2100000,
          },
          {
            slug: 'iphone-17',
            name: 'iPhone 17',
            brand: 'apple',
            price: 1500000,
          },
          {
            slug: 'iphone-16',
            name: 'iPhone 16',
            brand: 'APPLE',
            price: 1250000,
          },
          {
            slug: 'galaxy-s26-ultra',
            name: 'Galaxy S26 Ultra',
            brand: 'Samsung',
            price: 2500000,
          },
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'samsung',
            price: 480000,
          },
          {
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'SAMSUNG',
            price: 360000,
          },
        ],
      })
    ).toMatchObject({
      leftBrand: 'Apple',
      rightBrand: 'Samsung',
      leftBrandActiveCount: 3,
      rightBrandActiveCount: 3,
      canonicalSlug: 'apple-vs-samsung',
      isIndexable: true,
    });
  });

  it('derives price-band publication state from the same helper used by links and loaders', () => {
    expect(
      buildPriceBandCandidate({
        categorySlug: 'smartphones',
        band: CURATED_PRICE_BANDS.smartphones[1],
        products: [
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'Samsung',
            price: 480000,
          },
          {
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'Samsung',
            price: 360000,
          },
          {
            slug: 'redmi-note-14',
            name: 'Redmi Note 14',
            brand: 'Xiaomi',
            price: 390000,
          },
          {
            slug: 'redmi-note-14-pro',
            name: 'Redmi Note 14 Pro',
            brand: 'Xiaomi',
            price: 450000,
          },
          {
            slug: 'tecno-camon-40',
            name: 'Tecno Camon 40',
            brand: 'Tecno',
            price: 410000,
          },
          {
            slug: 'infinix-zero-40',
            name: 'Infinix Zero 40',
            brand: 'Infinix',
            price: 420000,
          },
        ],
      })
    ).toMatchObject({
      activeProductCount: 6,
      isIndexable: true,
    });
  });

  it('does not inflate price-band differentiating spec count beyond distinct brand count', () => {
    expect(
      buildPriceBandCandidate({
        categorySlug: 'smartphones',
        band: CURATED_PRICE_BANDS.smartphones[1],
        products: [
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'Samsung',
            price: 480000,
          },
          {
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'Samsung',
            price: 360000,
          },
          {
            slug: 'galaxy-a26',
            name: 'Galaxy A26',
            brand: 'Samsung',
            price: 320000,
          },
          {
            slug: 'redmi-note-14',
            name: 'Redmi Note 14',
            brand: 'Xiaomi',
            price: 390000,
          },
          {
            slug: 'redmi-note-14-pro',
            name: 'Redmi Note 14 Pro',
            brand: 'Xiaomi',
            price: 450000,
          },
          {
            slug: 'redmi-13',
            name: 'Redmi 13',
            brand: 'Xiaomi',
            price: 280000,
          },
        ],
      })
    ).toMatchObject({
      activeProductCount: 6,
      differentiatingSpecCount: 2,
      isIndexable: false,
    });
  });

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

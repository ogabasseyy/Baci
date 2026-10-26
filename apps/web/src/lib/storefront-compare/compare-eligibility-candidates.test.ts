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
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'iphone-17',
            name: 'iPhone 17',
            brand: 'Apple',
            price: 1500000,
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'iphone-16',
            name: 'iPhone 16',
            brand: 'Apple',
            price: 1250000,
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'samsung-galaxy-z-trifold',
            name: 'Samsung Galaxy Z TriFold',
            brand: 'Samsung',
            price: 7150000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
            },
          },
          {
            slug: 'galaxy-s26-ultra',
            name: 'Galaxy S26 Ultra',
            brand: 'Samsung',
            price: 2500000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
            },
          },
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'Samsung',
            price: 480000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
            },
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
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'iphone-17',
            name: 'iPhone 17',
            brand: 'apple',
            price: 1500000,
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'iphone-16',
            name: 'iPhone 16',
            brand: 'APPLE',
            price: 1250000,
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
          {
            slug: 'galaxy-s26-ultra',
            name: 'Galaxy S26 Ultra',
            brand: 'Samsung',
            price: 2500000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
            },
          },
          {
            slug: 'galaxy-a56',
            name: 'Galaxy A56',
            brand: 'samsung',
            price: 480000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
            },
          },
          {
            slug: 'galaxy-a36',
            name: 'Galaxy A36',
            brand: 'SAMSUNG',
            price: 360000,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
            },
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

  it('counts Redmi and Xiaomi as one canonical brand in price bands', () => {
    const candidate = buildPriceBandCandidate({
      categorySlug: 'smartphones',
      band: CURATED_PRICE_BANDS.smartphones[1],
      products: [
        { slug: 'redmi-1', name: 'Redmi 1', brand: 'Redmi', price: 300000 },
        { slug: 'redmi-2', name: 'Redmi 2', brand: 'Redmi', price: 320000 },
        { slug: 'xiaomi-1', name: 'Xiaomi 1', brand: 'Xiaomi', price: 340000 },
        { slug: 'xiaomi-2', name: 'Xiaomi 2', brand: 'Xiaomi', price: 360000 },
      ],
    });
    expect(candidate.differentiatingSpecCount).toBe(1);
    expect(candidate.isIndexable).toBe(false);
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
});

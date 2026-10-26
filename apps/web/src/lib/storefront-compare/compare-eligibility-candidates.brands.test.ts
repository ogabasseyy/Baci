import { describe, expect, it } from 'vitest';
import {
  buildBrandCompareCandidate,
  buildPriceBandCandidate,
} from './compare-eligibility';

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

  it('excludes relation metadata from brand spec differentiation', () => {
    const candidate = buildBrandCompareCandidate({
      categorySlug: 'smartphones',
      products: [
        ...[0, 1, 2].map((i) => ({
          slug: `iphone-${i}`,
          name: `iPhone ${i}`,
          brand: 'Apple',
          price: 500_000,
          product_key_specs: {
            ram_gb: 8,
            storage_gb: 128,
            created_at: `2026-01-0${i + 1}`,
          },
        })),
        ...[0, 1, 2].map((i) => ({
          slug: `galaxy-${i}`,
          name: `Galaxy ${i}`,
          brand: 'Samsung',
          price: 450_000,
          product_key_specs: {
            ram_gb: 12,
            storage_gb: 256,
            created_at: `2026-02-0${i + 1}`,
          },
        })),
      ],
    });
    expect(candidate?.differentiatingSpecCount).toBe(2);
    expect(candidate?.isIndexable).toBe(false);
  });

  it('derives the grouped slug from canonical keys regardless of alias order', () => {
    const specs = { storage_gb: 825, ram_gb: 16, chipset: 'A' };
    const sonyFirst = buildBrandCompareCandidate({
      categorySlug: 'gaming',
      products: [
        ...[0, 1, 2].map((i) => ({
          slug: `sony-${i}`,
          name: `Sony ${i}`,
          brand: i === 0 ? 'Sony' : 'PlayStation',
          price: 500_000,
          product_key_specs: specs,
        })),
        ...[0, 1, 2].map((i) => ({
          slug: `ms-${i}`,
          name: `Microsoft ${i}`,
          brand: i === 0 ? 'Microsoft' : 'Xbox',
          price: 450_000,
          product_key_specs: { storage_gb: 512, ram_gb: 12, chipset: 'B' },
        })),
      ],
    });
    expect(sonyFirst?.canonicalSlug).toBe('playstation-vs-xbox');
  });
});

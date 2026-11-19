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

  it('does not count null spec values as brand differences', () => {
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
            storage_gb: null,
            camera_mp: null,
            battery_mah: null,
          },
        })),
        ...[0, 1, 2].map((i) => ({
          slug: `galaxy-${i}`,
          name: `Galaxy ${i}`,
          brand: 'Samsung',
          price: 450_000,
          product_key_specs: {
            ram_gb: 8,
            storage_gb: 256,
            camera_mp: 50,
            battery_mah: 5000,
          },
        })),
      ],
    });
    expect(candidate?.differentiatingSpecCount).toBe(0);
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

  it('rejects placeholder brands (Gaming, Generic, N/A, NA, Unknown) from candidate eligibility', () => {
    const candidate = buildBrandCompareCandidate({
      categorySlug: 'smartphones',
      products: [
        ...[0, 1, 2].map((i) => ({
          slug: `gaming-phone-${i}`,
          name: `Gaming Phone ${i}`,
          brand: i === 0 ? 'Gaming' : i === 1 ? 'N/A' : 'NA',
          price: 500_000,
          product_key_specs: {
            ram_gb: 12,
            storage_gb: 256,
            refresh_rate: '144Hz',
          },
        })),
        ...[0, 1, 2].map((i) => ({
          slug: `generic-phone-${i}`,
          name: `Generic Phone ${i}`,
          brand: 'Generic',
          price: 450_000,
          product_key_specs: {
            ram_gb: 8,
            storage_gb: 128,
            refresh_rate: '60Hz',
          },
        })),
      ],
    });
    expect(candidate).toBeNull();
  });

  it('rejects placeholder brands from contributing to price-band indexability', () => {
    const candidate = buildPriceBandCandidate({
      categorySlug: 'smartphones',
      band: {
        slug: 'under-500k',
        label: 'Under ₦500k',
        ceiling: 500_000,
      },
      products: [
        { slug: 'p1', name: 'P1', brand: 'Gaming', price: 200_000 },
        { slug: 'p2', name: 'P2', brand: 'Generic', price: 250_000 },
        { slug: 'p3', name: 'P3', brand: 'Other', price: 300_000 },
        { slug: 'p4', name: 'P4', brand: 'Unknown', price: 350_000 },
        { slug: 'p5', name: 'P5', brand: 'N/A', price: 400_000 },
        { slug: 'p6', name: 'P6', brand: 'NA', price: 450_000 },
      ],
    });
    expect(candidate.activeProductCount).toBe(6);
    expect(candidate.differentiatingSpecCount).toBe(0);
    expect(candidate.isIndexable).toBe(false);
  });

  it('rejects canonical placeholder aliases (e.g. Game -> gaming) in brand compare', () => {
    const candidate = buildBrandCompareCandidate({
      categorySlug: 'gaming',
      products: [
        ...[0, 1, 2].map((i) => ({
          slug: `game-${i}`,
          name: `Game ${i}`,
          brand: 'Game',
          price: 50_000,
          product_key_specs: { platform: 'PS5', genre: 'Action' },
        })),
        ...[0, 1, 2].map((i) => ({
          slug: `playstation-${i}`,
          name: `PlayStation ${i}`,
          brand: 'PlayStation',
          price: 500_000,
          product_key_specs: { platform: 'PS5', storage_gb: 1000 },
        })),
      ],
    });
    expect(candidate).toBeNull();
  });

  it('counts only valid brands when a price band mixes valid and placeholder brands', () => {
    const candidate = buildPriceBandCandidate({
      categorySlug: 'smartphones',
      band: {
        slug: 'under-500k',
        label: 'Under ₦500k',
        ceiling: 500_000,
      },
      products: [
        { slug: 'v1', name: 'V1', brand: 'Samsung', price: 200_000 },
        { slug: 'v2', name: 'V2', brand: 'Apple', price: 250_000 },
        { slug: 'p1', name: 'P1', brand: 'Generic.Brand', price: 300_000 },
        { slug: 'p2', name: 'P2', brand: 'Unknown Products', price: 350_000 },
        { slug: 'p3', name: 'P3', brand: 'N/A', price: 400_000 },
        { slug: 'p4', name: 'P4', brand: 'Other', price: 450_000 },
      ],
    });
    expect(candidate.activeProductCount).toBe(6);
    expect(candidate.differentiatingSpecCount).toBe(2);
    expect(candidate.isIndexable).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  filterProductsByBrandSlugs,
  findFirstEligibleProductCompare,
  normalizeInferredBrands,
  resolveCanonicalBrandKey,
} from './filter-commercial-support-brands';

describe('filter-commercial-support-brands', () => {
  describe('resolveCanonicalBrandKey', () => {
    it('maps taxonomy aliases such as Redmi to canonical brand key xiaomi', () => {
      expect(resolveCanonicalBrandKey('smartphones', 'Redmi')).toBe('xiaomi');
      expect(resolveCanonicalBrandKey('smartphones', 'Xiaomi')).toBe('xiaomi');
    });

    it('maps known brands to their canonical brandKey', () => {
      expect(resolveCanonicalBrandKey('smartphones', 'Samsung')).toBe(
        'samsung'
      );
      expect(resolveCanonicalBrandKey('smartphones', 'Apple')).toBe('apple');
      expect(resolveCanonicalBrandKey('smartphones', 'Google')).toBe('google');
    });

    it('falls back to slugified brand name for uncurated brands', () => {
      expect(resolveCanonicalBrandKey('smartphones', 'OnePlus')).toBe(
        'oneplus'
      );
      expect(resolveCanonicalBrandKey('smartphones', 'Nothing Phone')).toBe(
        'nothing-phone'
      );
    });

    it('returns empty string for null, undefined, or empty brand', () => {
      expect(resolveCanonicalBrandKey('smartphones', null)).toBe('');
      expect(resolveCanonicalBrandKey('smartphones', undefined)).toBe('');
      expect(resolveCanonicalBrandKey('smartphones', '   ')).toBe('');
    });
  });

  describe('normalizeInferredBrands', () => {
    it('deduplicates brands that map to the same canonical key', () => {
      const result = normalizeInferredBrands('smartphones', [
        'Xiaomi',
        'Redmi',
        'xiaomi',
      ]);
      expect(result).toEqual(['xiaomi']);
    });

    it('filters out empty or invalid brand tokens', () => {
      const result = normalizeInferredBrands('smartphones', [
        'Samsung',
        '',
        '   ',
        'Apple',
      ]);
      expect(result).toEqual(['samsung', 'apple']);
    });
  });

  describe('filterProductsByBrandSlugs', () => {
    const products = [
      {
        slug: 'redmi-note-13',
        name: 'Redmi Note 13',
        brand: 'Redmi',
        price: 200_000,
      },
      {
        slug: 'galaxy-a55',
        name: 'Galaxy A55',
        brand: 'Samsung',
        price: 350_000,
      },
      {
        slug: 'iphone-15',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 800_000,
      },
    ];

    it('filters products matching any canonical brand slug', () => {
      const filtered = filterProductsByBrandSlugs('smartphones', products, [
        'xiaomi',
      ]);
      expect(filtered.map((p) => p.slug)).toEqual(['redmi-note-13']);
    });
  });

  describe('findFirstEligibleProductCompare', () => {
    const products = [
      {
        slug: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        brand: 'Apple',
        price: 800_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'A17 Pro', ram_gb: 8, storage_gb: 128 },
      },
      {
        slug: 'galaxy-s24',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 750_000,
        category_slug: 'smartphones',
        product_key_specs: {
          chipset: 'Snapdragon 8 Gen 3',
          ram_gb: 12,
          storage_gb: 256,
        },
      },
      {
        slug: 'redmi-note-13',
        name: 'Redmi Note 13',
        brand: 'Redmi',
        price: 200_000,
        category_slug: 'smartphones',
        product_key_specs: { chipset: 'Dimensity', ram_gb: 6, storage_gb: 128 },
      },
    ];

    it('prefers products matching inferred brands when available', () => {
      const result = findFirstEligibleProductCompare('smartphones', products, [
        'apple',
        'samsung',
      ]);

      expect(result).not.toBeNull();
      expect(result?.leftProduct.slug).toBe('iphone-15-pro');
      expect(result?.rightProduct.slug).toBe('galaxy-s24');
    });

    it('falls back to the first indexable pair when inferred brands are omitted', () => {
      const result = findFirstEligibleProductCompare('smartphones', products);

      expect(result).not.toBeNull();
      expect(result?.leftProduct.slug).toBe('iphone-15-pro');
      expect(result?.rightProduct.slug).toBe('galaxy-s24');
    });

    it('returns null when inferred brands match fewer than 2 products', () => {
      const result = findFirstEligibleProductCompare('smartphones', products, [
        'apple',
      ]);

      expect(result).toBeNull();
    });
  });
});

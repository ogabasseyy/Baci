import { describe, expect, it } from 'vitest';
import { findFirstEligibleProductCompare } from './find-first-eligible-product-compare';

describe('findFirstEligibleProductCompare', () => {
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

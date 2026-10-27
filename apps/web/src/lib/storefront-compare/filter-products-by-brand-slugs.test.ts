import { describe, expect, it } from 'vitest';
import { filterProductsByBrandSlugs } from './filter-products-by-brand-slugs';

describe('filterProductsByBrandSlugs', () => {
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
});

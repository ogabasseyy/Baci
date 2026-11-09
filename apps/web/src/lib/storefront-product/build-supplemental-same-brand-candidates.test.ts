import { describe, expect, it } from 'vitest';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-model.test-helpers';
import { buildSupplementalSameBrandCandidates } from './build-supplemental-same-brand-candidates';

describe('buildSupplementalSameBrandCandidates', () => {
  it('returns deduplicated available parent candidates for the current brand and aliases', () => {
    const currentProduct = makeCandidate({
      slug: 'redmi-note-14-pro',
      name: 'Redmi Note 14 Pro',
      brand: 'Redmi',
      price: 420_000,
    });
    const result = buildSupplementalSameBrandCandidates(
      makeInput({
        currentProduct,
        inventory: [currentProduct],
        hubEligibilityInventory: [
          {
            slug: 'redmi-note-14-pro',
            name: 'Redmi Note 14 Pro',
            brand: 'Redmi',
            price: 420_000,
            availability: 'InStock',
          },
          {
            slug: 'already-in-inventory',
            name: 'Xiaomi 14T',
            brand: 'Xiaomi',
            price: 680_000,
            availability: 'InStock',
          },
          {
            slug: 'xiaomi-14-ultra',
            name: 'Xiaomi 14 Ultra',
            brand: 'Xiaomi',
            condition: 'new',
            price: 1_100_000,
            stock: 0,
            manage_stock: false,
            availability: 'InStock',
          },
          {
            slug: 'redmi-child-variant',
            name: 'Redmi Note 14 256GB',
            brand: 'Redmi',
            price: 450_000,
            is_parent: false,
            parent_product_id: 'parent-1',
            availability: 'InStock',
          },
          {
            slug: 'redmi-managed-sold-out',
            name: 'Redmi 13C',
            brand: 'Redmi',
            price: 180_000,
            stock: 0,
            manage_stock: true,
            availability: 'InStock',
          },
        ],
      }),
      'redmi',
      new Set(['already-in-inventory'])
    );

    expect(result).toEqual([
      expect.objectContaining({
        slug: 'xiaomi-14-ultra',
        name: 'Xiaomi 14 Ultra',
        brand: 'Xiaomi',
        condition: 'new',
        price: 1_100_000,
        stock: null,
        manage_stock: false,
        category_slug: 'smartphones',
      }),
    ]);
  });
});

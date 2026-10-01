import { describe, expect, it } from 'vitest';
import { normalizeProductKeySpecs } from '@/lib/product-key-specs-normalize';
import { buildProductCompareCandidate } from './compare-eligibility';

describe('buildProductCompareCandidate recommendation arrays', () => {
  it('does not count identical recommendation arrays as compare differentiators', () => {
    expect(
      buildProductCompareCandidate({
        categorySlug: 'cameras',
        leftProduct: {
          slug: 'camera-a',
          name: 'Camera A',
          category_slug: 'cameras',
          product_key_specs: normalizeProductKeySpecs(
            {
              chipset: 'Digic X',
              ram_gb: 8,
              recommended_for: ['Photography', 'Travel'],
            },
            { preserveRecommendationArrays: true }
          ),
        },
        rightProduct: {
          slug: 'camera-b',
          name: 'Camera B',
          category_slug: 'cameras',
          product_key_specs: normalizeProductKeySpecs(
            {
              chipset: 'Digic X',
              ram_gb: 16,
              recommended_for: ['Photography', 'Travel'],
            },
            { preserveRecommendationArrays: true }
          ),
        },
      })
    ).toMatchObject({
      differentiatingSpecCount: 1,
      isIndexable: false,
    });
  });

  it('does not count recommendation arrays with the same tags in different orders', () => {
    expect(
      buildProductCompareCandidate({
        categorySlug: 'cameras',
        leftProduct: {
          slug: 'camera-a',
          name: 'Camera A',
          category_slug: 'cameras',
          product_key_specs: normalizeProductKeySpecs(
            {
              chipset: 'Digic X',
              ram_gb: 8,
              recommended_for: ['Photography', 'Travel'],
            },
            { preserveRecommendationArrays: true }
          ),
        },
        rightProduct: {
          slug: 'camera-b',
          name: 'Camera B',
          category_slug: 'cameras',
          product_key_specs: normalizeProductKeySpecs(
            {
              chipset: 'Digic X',
              ram_gb: 16,
              recommended_for: ['Travel', 'Photography'],
            },
            { preserveRecommendationArrays: true }
          ),
        },
      })
    ).toMatchObject({
      differentiatingSpecCount: 1,
      isIndexable: false,
    });
  });
});

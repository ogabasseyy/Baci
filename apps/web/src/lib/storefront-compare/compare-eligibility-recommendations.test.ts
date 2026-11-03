import { describe, expect, it } from 'vitest';
import { normalizeProductKeySpecs } from '@/lib/product-key-specs-normalize';
import {
  buildBrandCompareCandidate,
  buildProductCompareCandidate,
} from './compare-eligibility';

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

describe('buildBrandCompareCandidate recommendation arrays', () => {
  it('does not count brand spec arrays with the same tags in different orders', () => {
    const brandProducts = (
      brand: string,
      chipset: string,
      ram: number,
      recommendedFor: string[]
    ) =>
      [1, 2, 3].map((index) => ({
        slug: `${brand.toLowerCase()}-${index}`,
        name: `${brand} Camera ${index}`,
        brand,
        price: 100_000 * index,
        product_key_specs: {
          chipset,
          ram_gb: ram,
          recommended_for: recommendedFor,
        },
      }));

    expect(
      buildBrandCompareCandidate({
        categorySlug: 'cameras',
        products: [
          ...brandProducts('Canon', 'Digic X', 8, ['Photography', 'Travel']),
          ...brandProducts('Nikon', 'Expeed', 16, ['Travel', 'Photography']),
        ],
      })
    ).toMatchObject({
      differentiatingSpecCount: 2,
      isIndexable: false,
    });
  });
});

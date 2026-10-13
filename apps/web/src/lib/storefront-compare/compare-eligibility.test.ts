import { describe, expect, it } from 'vitest';
import {
  buildProductCompareCandidate,
  canPublishBrandComparePage,
  canPublishPriceBandPage,
  canPublishProductComparePage,
} from './compare-eligibility';

describe('compare eligibility thresholds', () => {
  it('rejects brand compare pages below the hard minimum', () => {
    expect(
      canPublishBrandComparePage({
        categorySlug: 'smartphones',
        leftBrandActiveCount: 2,
        rightBrandActiveCount: 4,
        differentiatingSpecCount: 4,
      })
    ).toBe(false);
  });

  it('rejects price-band pages below the hard minimum', () => {
    expect(
      canPublishPriceBandPage({
        categorySlug: 'smartphones',
        bandSlug: 'under-500k',
        activeProductCount: 5,
        differentiatingSpecCount: 3,
      })
    ).toBe(false);
  });

  it('requires same-category product comparisons with enough spec coverage', () => {
    expect(
      canPublishProductComparePage({
        categorySlug: 'smartphones',
        leftCategorySlug: 'smartphones',
        rightCategorySlug: 'laptops',
        differentiatingSpecCount: 6,
      })
    ).toBe(false);
  });

  it('derives product-compare publication from shared product key specs', () => {
    expect(
      buildProductCompareCandidate({
        categorySlug: 'smartphones',
        leftProduct: {
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          category_slug: 'smartphones',
          product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
        },
        rightProduct: {
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Snapdragon 8 Elite',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
      })
    ).toMatchObject({
      differentiatingSpecCount: 3,
      isIndexable: true,
    });
  });
});

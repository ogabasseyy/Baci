import { describe, expect, it } from 'vitest';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';
import { hasStockedRelatedBlogVariant } from './has-stocked-related-blog-variant';

const PRODUCT_ID = 'product-1';

function product(
  overrides: Partial<RelatedBlogProduct> = {}
): RelatedBlogProduct {
  return {
    id: PRODUCT_ID,
    name: 'iPhone 16',
    slug: 'iphone-16',
    category_slug: 'smartphones',
    stock: 0,
    stock_quantity: 0,
    ...overrides,
  };
}

describe('hasStockedRelatedBlogVariant', () => {
  it('uses a positive child quantity when one is present', () => {
    expect(
      hasStockedRelatedBlogVariant(
        [{ product_id: PRODUCT_ID, stock_quantity: 2 }],
        product()
      )
    ).toBe(true);
  });

  it('inherits positive parent stock for a nullable child quantity', () => {
    expect(
      hasStockedRelatedBlogVariant(
        [{ product_id: PRODUCT_ID, stock_quantity: null }],
        product({ stock: 5, stock_quantity: 5 })
      )
    ).toBe(true);
  });

  it('does not inherit stock for an empty parent', () => {
    expect(
      hasStockedRelatedBlogVariant(
        [{ product_id: PRODUCT_ID, stock_quantity: null }],
        product()
      )
    ).toBe(false);
  });
});

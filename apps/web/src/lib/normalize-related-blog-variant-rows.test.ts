import { describe, expect, it } from 'vitest';
import { normalizeRelatedBlogVariantRows } from './normalize-related-blog-variant-rows';

const PRODUCT = { id: 'product-1', price: 50000 } as never;

describe('normalizeRelatedBlogVariantRows', () => {
  it('returns an empty list for non-array data', () => {
    expect(normalizeRelatedBlogVariantRows(null, PRODUCT)).toEqual([]);
  });

  it('keeps only rows of the requested product with normalized fields', () => {
    expect(
      normalizeRelatedBlogVariantRows(
        [
          {
            id: 'variant-1',
            product_id: 'product-1',
            inventory_tracking_policy: 'serialized_strict',
            price_override: '60000',
            stock_quantity: '3',
          },
          { id: 'variant-2', product_id: 'product-9', stock_quantity: 5 },
          'not-a-row',
        ],
        PRODUCT
      )
    ).toEqual([
      {
        id: 'variant-1',
        inventory_tracking_policy: 'serialized_strict',
        price_override: 60000,
        stock_quantity: 3,
      },
    ]);
  });

  it('falls back to the parent price when the override is missing', () => {
    expect(
      normalizeRelatedBlogVariantRows(
        [{ id: 'variant-1', product_id: 'product-1', stock_quantity: 1 }],
        PRODUCT
      )
    ).toEqual([{ id: 'variant-1', price_override: 50000, stock_quantity: 1 }]);
  });
});

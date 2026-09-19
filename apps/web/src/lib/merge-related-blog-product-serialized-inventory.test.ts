import { describe, expect, it } from 'vitest';
import { mergeRelatedBlogProductSerializedInventory } from './merge-related-blog-product-serialized-inventory';

describe('mergeRelatedBlogProductSerializedInventory', () => {
  it('keeps rail order while replacing matching products with canonical data', () => {
    const products = [
      { id: 'product-1', name: 'Phone', slug: 'phone', category_slug: null },
      { id: 'product-2', name: 'Tablet', slug: 'tablet', category_slug: null },
    ];

    const result = mergeRelatedBlogProductSerializedInventory(products, [
      {
        ...products[0],
        has_purchasable_variant: true,
      },
    ]);

    expect(result).toEqual([
      {
        ...products[0],
        has_purchasable_variant: true,
      },
      products[1],
    ]);
  });
});

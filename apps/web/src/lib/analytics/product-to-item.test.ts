import { describe, expect, it } from 'vitest';
import type { AnalyticsProduct } from './analytics-product';
import { productToItem } from './product-to-item';

const product = {
  id: 'p-1',
  name: 'Phone',
  price: 100,
  category: 'legacy-cat',
  categories: { name: 'Phones' },
} as unknown as AnalyticsProduct;

describe('productToItem', () => {
  it('prefers the joined category name and defaults quantity to 1', () => {
    expect(productToItem(product)).toEqual({
      item_id: 'p-1',
      item_name: 'Phone',
      item_category: 'Phones',
      price: 100,
      quantity: 1,
      item_variant: undefined,
    });
  });

  it('falls back to the legacy category and carries quantity and variant', () => {
    const legacy = { ...product, categories: undefined } as AnalyticsProduct;

    expect(productToItem(legacy, 3, '128GB')).toMatchObject({
      item_category: 'legacy-cat',
      quantity: 3,
      item_variant: '128GB',
    });
  });
});

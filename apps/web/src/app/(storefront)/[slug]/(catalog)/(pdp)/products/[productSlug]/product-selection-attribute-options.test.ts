import { describe, expect, it } from 'vitest';
import type { ProductVariant } from '@/lib/products';
import { getAttributeOptions } from './product-selection-attribute-options';

describe('getAttributeOptions', () => {
  it('collects sorted unique values per attribute key', () => {
    const variants = [
      {
        id: 'v1',
        product_id: 'p1',
        merchant_id: 'm1',
        stock_quantity: 5,
        attributes: { storage: '256 GB', color: 'Blue' },
      },
      {
        id: 'v2',
        product_id: 'p1',
        merchant_id: 'm1',
        stock_quantity: 5,
        attributes: { storage: '128 GB', color: 'Blue' },
      },
    ] as ProductVariant[];
    expect(getAttributeOptions(variants)).toEqual([
      { key: 'storage', values: ['128 GB', '256 GB'] },
      { key: 'color', values: ['Blue'] },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { addStorefrontOrderLineOrdinals } from './add-storefront-order-line-ordinals';

describe('addStorefrontOrderLineOrdinals', () => {
  it('preserves item fields and assigns one-based request ordinals', () => {
    expect(
      addStorefrontOrderLineOrdinals([
        { product_id: 'product-1' },
        { product_id: 'product-2' },
      ])
    ).toEqual([
      { product_id: 'product-1', __baci_line_ordinal: 1 },
      { product_id: 'product-2', __baci_line_ordinal: 2 },
    ]);
  });

  it('overwrites caller-supplied reserved ordinals', () => {
    const result = addStorefrontOrderLineOrdinals([
      { product_id: 'product-1', __baci_line_ordinal: 99 },
    ]);

    expect(result).toEqual([
      { product_id: 'product-1', __baci_line_ordinal: 1 },
    ]);
  });
});

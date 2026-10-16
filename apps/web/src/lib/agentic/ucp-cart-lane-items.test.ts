import { describe, expect, it } from 'vitest';
import { toCanonicalLaneLine, toCheckoutLaneItem } from './ucp-cart-lane-items';

describe('UCP lane item mapping', () => {
  it('carries the full lane identity into the checkout calculator item', () => {
    expect(
      toCheckoutLaneItem({
        item: {
          condition: 'used',
          id: 'product-1',
          variant_attributes: { size: 'L' },
          variant_id: 'variant-1',
        },
        quantity: 2,
      })
    ).toEqual({
      condition: 'used',
      id: 'product-1',
      quantity: 2,
      variant_attributes: { size: 'L' },
      variant_id: 'variant-1',
    });
  });

  it('omits absent lane fields', () => {
    expect(
      toCheckoutLaneItem({ item: { id: 'product-1' }, quantity: 1 })
    ).toEqual({ id: 'product-1', quantity: 1 });
  });

  it('maps stored items back to canonical replacement lines', () => {
    expect(
      toCanonicalLaneLine({
        condition: 'used',
        id: 'product-1',
        quantity: 1,
        variant_attributes: { size: 'L' },
        variant_id: 'variant-1',
      })
    ).toEqual({
      item: {
        condition: 'used',
        options: { size: 'L' },
        productId: 'product-1',
        variantId: 'variant-1',
      },
      quantity: 1,
    });
  });
});

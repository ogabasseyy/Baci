import { describe, expect, it } from 'vitest';
import {
  resolveLowestPricedVariantSelection,
  resolveVariantSelection,
} from './product-default-variant';

describe('canonical public eligibility in generic variant selection', () => {
  it('honors projected strict eligibility under an unmanaged parent', () => {
    const product = {
      price: 100,
      manage_stock: false,
      variants: [
        {
          id: 'strict-empty',
          price_override: 80,
          stock_quantity: 0,
          is_purchasable: false,
        },
        {
          id: 'available',
          price_override: 120,
          stock_quantity: 2,
          is_purchasable: true,
        },
      ],
    };
    expect(resolveLowestPricedVariantSelection(product)?.variant.id).toBe(
      'available'
    );
    expect(
      resolveVariantSelection(product, { variantId: 'strict-empty' })
    ).toBeNull();
  });
  it('uses confirmed parent-inherited eligibility for a nullable child', () => {
    expect(
      resolveLowestPricedVariantSelection({
        price: 100,
        manage_stock: true,
        variants: [
          { id: 'inherited', stock_quantity: null, is_purchasable: true },
        ],
      })?.variant.id
    ).toBe('inherited');
  });
});

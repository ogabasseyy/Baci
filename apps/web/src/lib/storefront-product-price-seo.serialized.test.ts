import { describe, expect, it } from 'vitest';
import { getProductPriceRange } from './storefront-product-price-seo';

describe('serialized variant prices', () => {
  it('keeps a depleted serialized-then-unlimited variant advertised', () => {
    expect(
      getProductPriceRange({
        name: 'Phone',
        manage_stock: false,
        has_variants: true,
        price: 100,
        variants: [
          {
            inventory_tracking_policy: 'serialized_then_unlimited',
            stock_quantity: 0,
            price_override: 80,
          },
        ],
      })
    ).toEqual({ min: 80, max: 80, hasRange: false });
  });
  it('excludes a depleted strict child even under an unlimited parent', () => {
    expect(
      getProductPriceRange({
        name: 'Phone',
        manage_stock: false,
        has_variants: true,
        price: 100,
        variants: [
          {
            inventory_tracking_policy: 'serialized_strict',
            stock_quantity: 0,
            price_override: 80,
          },
        ],
      })
    ).toBeNull();
  });
  it('keeps the unlimited sibling price in a mixed policy product', () => {
    expect(
      getProductPriceRange({
        name: 'Phone',
        manage_stock: false,
        has_variants: true,
        price: 100,
        variants: [
          {
            inventory_tracking_policy: 'serialized_strict',
            stock_quantity: 0,
            price_override: 80,
          },
          {
            inventory_tracking_policy: 'off',
            stock_quantity: 0,
            price_override: 120,
          },
        ],
      })
    ).toEqual({ min: 120, max: 120, hasRange: false });
  });
});

import { describe, expect, it } from 'vitest';
import { isProductVariantPurchasable } from './is-product-variant-purchasable';

describe('isProductVariantPurchasable', () => {
  it('uses canonical projected eligibility before parent stock settings', () => {
    expect(isProductVariantPurchasable(false, { is_purchasable: false })).toBe(
      false
    );
    expect(
      isProductVariantPurchasable(true, {
        is_purchasable: true,
        stock_quantity: 0,
      })
    ).toBe(true);
  });

  it('preserves parent and child stock fallbacks when eligibility is absent', () => {
    expect(isProductVariantPurchasable(false, { stock_quantity: 0 })).toBe(
      true
    );
    expect(isProductVariantPurchasable(true, { stock_quantity: 0 })).toBe(
      false
    );
    expect(isProductVariantPurchasable(true, { in_stock: false })).toBe(false);
    expect(isProductVariantPurchasable(undefined, {})).toBe(true);
  });
});

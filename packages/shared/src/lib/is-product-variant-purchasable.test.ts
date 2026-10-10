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

  it('resolves serialized tracking from exact units ahead of the scalar', () => {
    expect(
      isProductVariantPurchasable(true, {
        effective_policy: 'serialized_strict',
        available_units: 2,
        stock_quantity: 0,
      })
    ).toBe(true);
    expect(
      isProductVariantPurchasable(true, {
        effective_policy: 'serialized_strict',
        available_units: 0,
        stock_quantity: 5,
      })
    ).toBe(false);
    expect(
      isProductVariantPurchasable(true, {
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: 1,
      })
    ).toBe(true);
  });

  it('resolves strict serialized units ahead of the unmanaged shortcut', () => {
    expect(
      isProductVariantPurchasable(false, {
        effective_policy: 'serialized_strict',
        available_units: 0,
        stock_quantity: 5,
      })
    ).toBe(false);
    expect(
      isProductVariantPurchasable(false, {
        effective_policy: 'serialized_strict',
        available_units: 1,
      })
    ).toBe(true);
    expect(
      isProductVariantPurchasable(false, {
        effective_policy: 'serialized_then_unlimited',
        stock_quantity: 0,
      })
    ).toBe(true);
  });

  it('keeps unlimited tracking enabled regardless of scalar stock', () => {
    expect(
      isProductVariantPurchasable(true, {
        effective_policy: 'serialized_then_unlimited',
        stock_quantity: 0,
      })
    ).toBe(true);
  });
});

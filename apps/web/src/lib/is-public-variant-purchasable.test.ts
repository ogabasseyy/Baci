import { describe, expect, it } from 'vitest';
import { isPublicVariantPurchasable } from './is-public-variant-purchasable';

describe('isPublicVariantPurchasable', () => {
  it.each([
    [false, 'off', 0, true],
    [true, 'off', 0, false],
    [false, 'serialized_strict', 0, false],
    [false, 'serialized_strict', 1, true],
    [true, 'serialized_then_unlimited', 0, true],
  ] as const)('resolves parent=%s policy=%s units=%s', (manage_stock, policy, stock_quantity, expected) => {
    expect(
      isPublicVariantPurchasable(
        { manage_stock },
        {
          inventory_tracking_policy: policy,
          stock_quantity,
        }
      )
    ).toBe(expected);
  });

  it('inherits parent stock for a nullable child under a managed parent', () => {
    expect(
      isPublicVariantPurchasable(
        { manage_stock: true, stock_quantity: 4 },
        { stock_quantity: null }
      )
    ).toBe(true);
    expect(
      isPublicVariantPurchasable(
        { manage_stock: true, stock_quantity: 0 },
        { stock_quantity: null }
      )
    ).toBe(false);
  });

  it('keeps serialized units exact without parent inheritance', () => {
    expect(
      isPublicVariantPurchasable(
        { manage_stock: true, stock_quantity: 4 },
        {
          inventory_tracking_policy: 'serialized_strict',
          stock_quantity: null,
        }
      )
    ).toBe(false);
  });
});

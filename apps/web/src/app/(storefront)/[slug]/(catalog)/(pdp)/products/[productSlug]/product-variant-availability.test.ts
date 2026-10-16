import { describe, expect, it } from 'vitest';
import type { ProductVariant } from '@/lib/products';
import { isVariantAvailable } from './product-variant-availability';

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'variant-1',
    product_id: 'product-1',
    name: 'Variant 1',
    attributes: { color: 'red' },
    stock_quantity: 5,
    ...overrides,
  } as ProductVariant;
}

describe('isVariantAvailable', () => {
  it('ignores stock when inventory is unmanaged', () => {
    expect(
      isVariantAvailable(
        [variant({ stock_quantity: 0 })],
        { color: 'red' },
        false,
        0
      )
    ).toBe(true);
    expect(
      isVariantAvailable(
        [variant({ stock_quantity: 0 })],
        { color: 'blue' },
        false,
        0
      )
    ).toBe(false);
  });

  it('gates managed variants on scalar stock with parent fallback', () => {
    expect(
      isVariantAvailable(
        [variant({ stock_quantity: 0 })],
        { color: 'red' },
        true,
        0
      )
    ).toBe(false);
    expect(
      isVariantAvailable(
        [variant({ stock_quantity: undefined })],
        { color: 'red' },
        true,
        4
      )
    ).toBe(true);
  });

  it('resolves serialized policies from exact units', () => {
    expect(
      isVariantAvailable(
        [
          variant({
            inventory_tracking_policy: 'serialized_strict',
            available_units: 0,
            stock_quantity: 9,
          }),
        ],
        { color: 'red' },
        true,
        9
      )
    ).toBe(false);
    expect(
      isVariantAvailable(
        [
          variant({
            inventory_tracking_policy: 'serialized_then_unlimited',
            stock_quantity: 0,
          }),
        ],
        { color: 'red' },
        true,
        0
      )
    ).toBe(true);
  });

  it('filters by condition when variant conditions are in use', () => {
    const variants = [variant({ condition: 'used' })];
    expect(
      isVariantAvailable([variant({ condition: 'new' })], {}, true, 5, {
        condition: 'used',
        usesVariantConditions: true,
      })
    ).toBe(false);
    expect(
      isVariantAvailable(variants, {}, true, 5, {
        condition: 'used',
        usesVariantConditions: true,
      })
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveSerializedVariantStock } from './serialized-variant-stock';

describe('resolveSerializedVariantStock', () => {
  it('returns infinity for unlimited tracking regardless of scalar stock', () => {
    expect(
      resolveSerializedVariantStock({
        effective_policy: 'serialized_then_unlimited',
        stock_quantity: 0,
      })
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      resolveSerializedVariantStock({
        inventory_tracking_policy: 'serialized_then_unlimited',
        stock_quantity: 0,
      })
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('prefers exact units over a stale scalar for strict tracking', () => {
    expect(
      resolveSerializedVariantStock({
        effective_policy: 'serialized_strict',
        available_units: 3,
        stock_quantity: 0,
      })
    ).toBe(3);
    expect(
      resolveSerializedVariantStock({
        effective_policy: 'serialized_strict',
        available_units: 0,
        stock_quantity: 5,
      })
    ).toBe(0);
  });

  it('falls back to the scalar when strict units were not projected', () => {
    expect(
      resolveSerializedVariantStock({
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: 1,
      })
    ).toBe(1);
    expect(
      resolveSerializedVariantStock({
        effective_policy: 'serialized_strict',
        stock_quantity: null,
      })
    ).toBe(0);
  });

  it('lets the inherited effective policy override the row-local policy', () => {
    expect(
      resolveSerializedVariantStock({
        effective_policy: 'serialized_then_unlimited',
        inventory_tracking_policy: 'serialized_strict',
        available_units: 0,
        stock_quantity: 0,
      })
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns undefined for non-serialized policies', () => {
    expect(
      resolveSerializedVariantStock({ stock_quantity: 4 })
    ).toBeUndefined();
    expect(
      resolveSerializedVariantStock({
        inventory_tracking_policy: 'off',
        stock_quantity: 0,
      })
    ).toBeUndefined();
  });
});

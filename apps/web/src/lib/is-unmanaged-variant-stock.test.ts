import { describe, expect, it } from 'vitest';
import {
  isExplicitlyTrackedVariantStock,
  isUnmanagedVariantStock,
} from './is-unmanaged-variant-stock';

describe('isUnmanagedVariantStock', () => {
  it('requires stock management to be explicitly disabled', () => {
    const variant = { inventory_tracking_policy: 'off' as const };

    expect(isUnmanagedVariantStock(variant, false)).toBe(true);
    expect(isUnmanagedVariantStock(variant, true)).toBe(false);
    expect(isUnmanagedVariantStock(variant, null)).toBe(false);
    expect(isUnmanagedVariantStock(variant, undefined)).toBe(false);
  });

  it('uses effective policy ahead of the row-local policy', () => {
    expect(
      isUnmanagedVariantStock(
        {
          effective_policy: 'serialized_strict',
          inventory_tracking_policy: 'off',
        },
        false
      )
    ).toBe(false);
    expect(
      isUnmanagedVariantStock(
        {
          effective_policy: 'off',
          inventory_tracking_policy: 'serialized_strict',
        },
        false
      )
    ).toBe(true);
  });

  it('returns false for nullish variants', () => {
    expect(isUnmanagedVariantStock(null, false)).toBe(false);
    expect(isUnmanagedVariantStock(undefined, false)).toBe(false);
  });

  it('returns false for policies other than off', () => {
    expect(
      isUnmanagedVariantStock(
        { inventory_tracking_policy: 'serialized_then_unlimited' },
        false
      )
    ).toBe(false);
  });
});

describe('isExplicitlyTrackedVariantStock', () => {
  it.each([
    [{ inventory_tracking_policy: 'standard' }, true],
    [{ effective_policy: 'standard', inventory_tracking_policy: 'off' }, true],
    [{ effective_policy: 'off', inventory_tracking_policy: 'standard' }, false],
    [{ inventory_tracking_policy: 'serialized_strict' }, true],
    [{ inventory_tracking_policy: 'serialized_then_unlimited' }, true],
    [{ inventory_tracking_policy: 'off' }, false],
    [null, false],
    [undefined, false],
  ] as const)('classifies policy %o', (variant, expected) => {
    expect(isExplicitlyTrackedVariantStock(variant)).toBe(expected);
  });
});

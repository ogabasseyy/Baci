import { describe, expect, it } from 'vitest';
import { isExplicitlyTrackedVariantStock } from './is-explicitly-tracked-variant-stock';

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

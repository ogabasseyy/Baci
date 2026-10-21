import { describe, expect, it } from 'vitest';
import { resolveOfferAllocatableStock } from './resolve-offer-allocatable-stock';

describe('resolveOfferAllocatableStock', () => {
  it('binds the finite scalar on legacy policies', () => {
    expect(resolveOfferAllocatableStock(2, { parentStock: 9 })).toBe(2);
    expect(resolveOfferAllocatableStock(0, { parentStock: 9 })).toBe(0);
  });

  it('inherits the parent stock when the scalar is missing', () => {
    expect(resolveOfferAllocatableStock(null, { parentStock: 9 })).toBe(9);
  });

  it('caps strict scalars by the base units', () => {
    expect(
      resolveOfferAllocatableStock(5, {
        parentStock: 9,
        effective_policy: 'serialized_strict',
        availableUnits: 2,
      })
    ).toBe(2);
    expect(
      resolveOfferAllocatableStock(null, {
        parentStock: 9,
        effective_policy: 'serialized_strict',
        availableUnits: 2,
      })
    ).toBe(2);
  });

  it('keeps unlimited null scalars unbounded', () => {
    expect(
      resolveOfferAllocatableStock(null, {
        parentStock: 9,
        effective_policy: 'serialized_then_unlimited',
      })
    ).toBeNull();
    expect(
      resolveOfferAllocatableStock(4, {
        parentStock: 9,
        effective_policy: 'serialized_then_unlimited',
      })
    ).toBe(4);
  });
});

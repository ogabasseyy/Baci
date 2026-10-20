import { describe, expect, it } from 'vitest';
import { toFiniteOfferPrice } from './offer-authority-client';
import {
  resolveOfferAllocatableStock,
  resolveOfferPriceBasis,
} from './offer-economics-basis';

describe('toFiniteOfferPrice', () => {
  it('rejects blank values instead of pricing at zero', () => {
    expect(toFiniteOfferPrice(null)).toBeNull();
    expect(toFiniteOfferPrice(undefined)).toBeNull();
    expect(toFiniteOfferPrice('')).toBeNull();
    expect(toFiniteOfferPrice('abc')).toBeNull();
    expect(toFiniteOfferPrice('80.5')).toBe(80.5);
    expect(toFiniteOfferPrice(0)).toBe(0);
  });
});

describe('resolveOfferPriceBasis', () => {
  it('prices from the finite offer price, else the parent', () => {
    expect(resolveOfferPriceBasis('80', 100)).toBe(80);
    expect(resolveOfferPriceBasis(null, 100)).toBe(100);
    expect(resolveOfferPriceBasis('', 100)).toBe(100);
  });
});

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

import { describe, expect, it } from 'vitest';
import { toFiniteNumber } from './to-finite-number';

describe('toFiniteNumber', () => {
  it('rejects blank and non-finite values instead of coercing to zero', () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('coerces finite numerics and numeric strings', () => {
    expect(toFiniteNumber('80.5')).toBe(80.5);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-3)).toBe(-3);
  });
});

import { describe, expect, it } from 'vitest';
import { toFinitePrice } from './to-finite-price';

describe('toFinitePrice', () => {
  it('keeps finite non-negative numbers', () => {
    expect(toFinitePrice(150000)).toBe(150000);
    expect(toFinitePrice(0)).toBe(0);
  });

  it('parses numeric strings', () => {
    expect(toFinitePrice('120000')).toBe(120000);
    expect(toFinitePrice('  99.5  ')).toBe(99.5);
  });

  it('rejects missing, negative, and non-numeric values', () => {
    expect(toFinitePrice(null)).toBeNull();
    expect(toFinitePrice(undefined)).toBeNull();
    expect(toFinitePrice('')).toBeNull();
    expect(toFinitePrice('  ')).toBeNull();
    expect(toFinitePrice(-5)).toBeNull();
    expect(toFinitePrice(Number.NaN)).toBeNull();
    expect(toFinitePrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFinitePrice('not-a-price')).toBeNull();
    expect(toFinitePrice({})).toBeNull();
  });
});

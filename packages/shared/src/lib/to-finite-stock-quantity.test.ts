import { describe, expect, it } from 'vitest';
import { toFiniteStockQuantity } from './to-finite-stock-quantity';

describe('toFiniteStockQuantity', () => {
  it('floors finite scalars and clamps negatives at zero', () => {
    expect(toFiniteStockQuantity(2.9)).toBe(2);
    expect(toFiniteStockQuantity('3')).toBe(3);
    expect(toFiniteStockQuantity(-4)).toBe(0);
    expect(toFiniteStockQuantity(0)).toBe(0);
  });

  it('keeps absent values null', () => {
    expect(toFiniteStockQuantity(null)).toBeNull();
    expect(toFiniteStockQuantity(undefined)).toBeNull();
    expect(toFiniteStockQuantity('')).toBeNull();
    expect(toFiniteStockQuantity('abc')).toBeNull();
  });
});

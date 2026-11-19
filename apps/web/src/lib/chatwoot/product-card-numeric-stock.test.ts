import { describe, expect, it } from 'vitest';
import { numericStock } from './product-card-numeric-stock';

describe('numericStock', () => {
  it('reads numeric stock from numbers and numeric strings', () => {
    expect(numericStock(3)).toBe(3);
    expect(numericStock('4')).toBe(4);
    expect(numericStock('abc')).toBeNull();
    expect(numericStock(undefined)).toBeNull();
  });
});

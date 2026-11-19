import { describe, expect, it } from 'vitest';
import { toPrice } from './product-card-to-price';

describe('toPrice', () => {
  it('accepts only finite non-negative numeric prices', () => {
    expect(toPrice(0)).toBe(0);
    expect(toPrice(10.5)).toBe(10.5);
    expect(toPrice(-1)).toBeNull();
    expect(toPrice(Number.NaN)).toBeNull();
    expect(toPrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toPrice('10')).toBeNull();
  });
});

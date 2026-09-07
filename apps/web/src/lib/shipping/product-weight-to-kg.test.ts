import { describe, expect, it } from 'vitest';
import { productWeightToKg } from './product-weight-to-kg';

describe('productWeightToKg', () => {
  it('converts supported metric and imperial units to kilograms', () => {
    expect(productWeightToKg(2, 'kg')).toBe(2);
    expect(productWeightToKg(500, 'g')).toBe(0.5);
    expect(productWeightToKg(2, 'lb')).toBeCloseTo(0.90718474, 8);
    expect(productWeightToKg(16, 'oz')).toBeCloseTo(0.45359237, 8);
  });

  it('returns null for missing, invalid, or unsupported units', () => {
    expect(productWeightToKg(null, 'kg')).toBeNull();
    expect(productWeightToKg(0, 'kg')).toBeNull();
    expect(productWeightToKg(2, 'stone')).toBeNull();
  });
});

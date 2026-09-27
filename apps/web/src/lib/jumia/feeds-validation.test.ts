import { describe, expect, it } from 'vitest';
import {
  validatePositiveNumber,
  validateRequiredString,
  validateVariation,
} from './feeds-validation';

describe('Jumia feed validation helpers', () => {
  it('trims required strings and accepts positive numbers', () => {
    expect(validateRequiredString(' SKU-1 ', 'sku', 'test')).toBe('SKU-1');
    expect(validatePositiveNumber(1, 'code', 'test')).toBe(1);
  });

  it('rejects invalid variation prices and stock', () => {
    expect(() =>
      validateVariation({ globalPrice: { value: -1 } }, 0, 'test')
    ).toThrow('globalPrice.value must be >= 0');
    expect(() =>
      validateVariation({ globalPrice: { value: 1 }, stock: -1 }, 0, 'test')
    ).toThrow('stock must be >= 0');
  });
});

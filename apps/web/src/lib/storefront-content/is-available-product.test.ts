import { describe, expect, it } from 'vitest';
import { isAvailableProduct } from './is-available-product';

describe('isAvailableProduct', () => {
  it('treats unmanaged rows as available regardless of stock columns', () => {
    expect(isAvailableProduct({ stock: 0, manage_stock: false })).toBe(true);
    expect(isAvailableProduct({ stock: 0, manage_stock: null })).toBe(true);
    expect(isAvailableProduct({ stock: 0 })).toBe(true);
    expect(isAvailableProduct({ stock: null, manage_stock: null })).toBe(true);
  });

  it('requires positive stock for explicitly managed rows', () => {
    expect(isAvailableProduct({ stock: 3, manage_stock: true })).toBe(true);
    expect(isAvailableProduct({ stock: 0, manage_stock: true })).toBe(false);
    expect(isAvailableProduct({ stock: null, manage_stock: true })).toBe(false);
  });
});

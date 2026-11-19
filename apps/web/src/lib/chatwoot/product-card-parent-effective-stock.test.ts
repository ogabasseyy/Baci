import { describe, expect, it } from 'vitest';
import { parentEffectiveStock } from './product-card-parent-effective-stock';

describe('parentEffectiveStock', () => {
  it('prefers positive stock_quantity and falls back to legacy stock', () => {
    expect(parentEffectiveStock({ stock_quantity: 5, stock: 9 })).toBe(5);
    expect(parentEffectiveStock({ stock_quantity: 0, stock: 3.7 })).toBe(3);
    expect(parentEffectiveStock({ stock_quantity: -2 })).toBe(0);
    expect(parentEffectiveStock({})).toBe(0);
  });
});

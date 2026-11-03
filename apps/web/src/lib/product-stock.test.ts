import { describe, expect, it } from 'vitest';
import {
  getEffectiveStock,
  matchesProductStockFilter,
} from '@/lib/product-stock';

describe('getEffectiveStock', () => {
  it('prefers stock_quantity when present and positive', () => {
    expect(getEffectiveStock({ stock: 0, stock_quantity: 4 })).toBe(4);
  });

  it('falls back to legacy stock when stock_quantity is missing', () => {
    expect(getEffectiveStock({ stock: 6 })).toBe(6);
  });

  it('falls back to legacy stock when stock_quantity drifted to zero', () => {
    expect(getEffectiveStock({ stock: 9, stock_quantity: 0 })).toBe(9);
  });

  it('clamps invalid or negative values to zero', () => {
    expect(getEffectiveStock({ stock: -2, stock_quantity: Number.NaN })).toBe(
      0
    );
  });
});

describe('matchesProductStockFilter', () => {
  it('treats unmanaged stock as in stock', () => {
    expect(
      matchesProductStockFilter(
        { manage_stock: false, stock: 0, stock_quantity: 0 },
        'in_stock'
      )
    ).toBe(true);
  });

  it('never treats unmanaged stock as out of stock', () => {
    expect(
      matchesProductStockFilter(
        { manage_stock: false, stock: 0, stock_quantity: 0 },
        'out_of_stock'
      )
    ).toBe(false);
  });

  it('uses effective stock for out-of-stock matching', () => {
    expect(
      matchesProductStockFilter(
        { manage_stock: true, stock: 7, stock_quantity: 0 },
        'out_of_stock'
      )
    ).toBe(false);
  });

  it('matches infinite stock only for unmanaged products', () => {
    expect(
      matchesProductStockFilter(
        { manage_stock: false, stock: 0, stock_quantity: 0 },
        'infinite'
      )
    ).toBe(true);

    expect(
      matchesProductStockFilter(
        { manage_stock: true, stock: 7, stock_quantity: 7 },
        'infinite'
      )
    ).toBe(false);
  });
});

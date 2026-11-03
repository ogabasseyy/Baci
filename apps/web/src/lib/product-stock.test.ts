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

  describe('filter agreement across all manage_stock states', () => {
    it.each([
      {
        label: 'manage_stock: false (unmanaged)',
        item: { manage_stock: false, stock: 0, stock_quantity: 0 },
        inStock: true,
        outOfStock: false,
        infinite: true,
      },
      {
        label: 'manage_stock: null (unmanaged)',
        item: { manage_stock: null, stock: 0, stock_quantity: 0 },
        inStock: true,
        outOfStock: false,
        infinite: true,
      },
      {
        label: 'manage_stock: undefined (unmanaged)',
        item: { stock: 0, stock_quantity: 0 },
        inStock: true,
        outOfStock: false,
        infinite: true,
      },
      {
        label: 'manage_stock: true with zero stock (tracked sold-out)',
        item: { manage_stock: true, stock: 0, stock_quantity: 0 },
        inStock: false,
        outOfStock: true,
        infinite: false,
      },
      {
        label: 'manage_stock: true with positive stock (tracked in-stock)',
        item: { manage_stock: true, stock: 0, stock_quantity: 10 },
        inStock: true,
        outOfStock: false,
        infinite: false,
      },
      {
        label: 'manage_stock: true with legacy stock (tracked in-stock)',
        item: { manage_stock: true, stock: 5, stock_quantity: 0 },
        inStock: true,
        outOfStock: false,
        infinite: false,
      },
    ])('$label: in_stock=$inStock, out_of_stock=$outOfStock, infinite=$infinite', ({
      item,
      inStock,
      outOfStock,
      infinite,
    }) => {
      expect(matchesProductStockFilter(item, 'in_stock')).toBe(inStock);
      expect(matchesProductStockFilter(item, 'out_of_stock')).toBe(outOfStock);
      expect(matchesProductStockFilter(item, 'infinite')).toBe(infinite);
    });
  });
});

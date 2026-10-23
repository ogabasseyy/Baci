import { describe, expect, it } from 'vitest';
import { resolveVariantInventory } from './resolve-variant-inventory';

describe('resolveVariantInventory', () => {
  it.each([
    0, 4,
  ])('inherits stock %s for a standard variant with null quantity', (stock) => {
    expect(
      resolveVariantInventory(
        { manage_stock: false, stock },
        { effective_policy: 'standard', stock_quantity: null }
      )
    ).toEqual({
      manageStock: true,
      stock,
      stockQuantity: stock,
      purchasable: stock > 0,
    });
  });
  it('keeps unmanaged inventory infinite despite a zero snapshot', () => {
    expect(
      resolveVariantInventory(
        { manage_stock: false, stock: 0 },
        { effective_policy: 'off', stock_quantity: 0 }
      )
    ).toEqual({
      manageStock: false,
      stock: 0,
      stockQuantity: Number.POSITIVE_INFINITY,
      purchasable: true,
    });
  });
  it('uses exact strict units ahead of stale scalar stock', () => {
    expect(
      resolveVariantInventory(
        { manage_stock: false, stock: 9 },
        {
          effective_policy: 'serialized_strict',
          available_units: 0,
          stock_quantity: 9,
        }
      )
    ).toMatchObject({ manageStock: true, stock: 0, purchasable: false });
  });
  it('keeps then-unlimited inventory unbounded', () => {
    expect(
      resolveVariantInventory(
        { manage_stock: false, stock: 0 },
        { effective_policy: 'serialized_then_unlimited', stock_quantity: 0 }
      )
    ).toMatchObject({ stock: Number.POSITIVE_INFINITY, purchasable: true });
  });
});

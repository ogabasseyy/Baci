import { describe, expect, it } from 'vitest';
import { isInventoryTrackedProduct } from './is-inventory-tracked-product';

describe('isInventoryTrackedProduct', () => {
  it('recognizes legacy managed stock', () => {
    expect(
      isInventoryTrackedProduct({ id: 'product-1', manage_stock: true })
    ).toBe(true);
  });

  it('does not treat unlimited stock as an inventory mutation', () => {
    expect(
      isInventoryTrackedProduct({ id: 'product-1', manage_stock: false })
    ).toBe(false);
  });

  it('recognizes product-level serialized tracking when legacy stock is off', () => {
    expect(
      isInventoryTrackedProduct({
        id: 'product-1',
        inventory_tracking_policy: 'serialized_strict',
        manage_stock: false,
      })
    ).toBe(true);
  });

  it('recognizes a serialized child variant under an unlimited parent', () => {
    expect(
      isInventoryTrackedProduct(
        {
          id: 'product-1',
          inventory_tracking_policy: 'off',
          manage_stock: false,
        },
        [
          {
            inventory_tracking_policy: 'serialized_then_unlimited',
            product_id: 'product-1',
          },
        ]
      )
    ).toBe(true);
  });
});

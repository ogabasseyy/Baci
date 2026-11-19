import { describe, expect, it } from 'vitest';
import { isPurchasableProduct } from './product-card-is-purchasable-product';

describe('isPurchasableProduct', () => {
  it('applies the inventory policy when judging purchasability', () => {
    expect(
      isPurchasableProduct({ effective_policy: 'serialized_then_unlimited' })
    ).toBe(true);
    expect(
      isPurchasableProduct({
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: 0,
      })
    ).toBe(false);
    expect(
      isPurchasableProduct({
        effective_policy: 'serialized_strict',
        stock_quantity: 2,
      })
    ).toBe(true);
    expect(isPurchasableProduct({ manage_stock: false })).toBe(true);
    expect(isPurchasableProduct({ stock_quantity: 0 })).toBe(false);
    expect(isPurchasableProduct({ stock_quantity: 1 })).toBe(true);
  });
});

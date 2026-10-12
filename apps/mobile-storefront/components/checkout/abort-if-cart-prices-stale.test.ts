import { describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { repriceCartItems } from '@/services/cart-reprice';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';
import { abortIfCartPricesStale } from './abort-if-cart-prices-stale';

jest.mock('@/services/cart-reprice', () => ({
  repriceCartItems: jest.fn(),
  pickChangedPriceById: jest.fn(() => ({})),
  pickChangedConditionById: jest.fn(() => ({})),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: jest.fn() },
}));

const mockReprice = repriceCartItems as unknown as jest.MockedFunction<
  typeof repriceCartItems
>;
const mockGetState = useCartStore.getState as unknown as jest.Mock;

function cartItem(): CartItem {
  return {
    id: 'line-1',
    product_id: 'product-1',
    name: 'iPhone 13',
    price: 390000,
    quantity: 1,
  } as CartItem;
}

describe('abortIfCartPricesStale', () => {
  it('aborts with a removal path when lines vanished from the catalog', async () => {
    mockReprice.mockResolvedValue({
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      unavailable: [{ id: 'line-1', name: 'iPhone 13' }],
    });
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    const result = await abortIfCartPricesStale([cartItem()], 'merchant-1');

    expect(result).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(
      'Items no longer available',
      expect.stringContaining('iPhone 13'),
      expect.anything()
    );
    expect(mockGetState).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('lets checkout proceed when nothing moved or vanished', async () => {
    mockReprice.mockResolvedValue({
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      unavailable: [],
    });

    const result = await abortIfCartPricesStale([cartItem()], 'merchant-1');

    expect(result).toBe(false);
  });
});

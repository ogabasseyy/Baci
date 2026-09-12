import { jest } from '@jest/globals';
import { useCartStore } from '@/stores/cart-store';
import { clearAndPersistCheckoutCart } from './checkout-cart-persistence';

const mockSetItem = jest.fn<(key: string, value: string) => Promise<void>>(
  async () => undefined
);

jest.mock('@/lib/storage', () => ({
  asyncStorage: {
    setItem: (key: string, value: string) => mockSetItem(key, value),
  },
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: jest.fn(),
    persist: {
      getOptions: () => ({
        name: 'cart-storage',
        partialize: (state: { items: unknown[] }) => ({ items: state.items }),
        version: 0,
      }),
    },
  },
}));

it('awaits clearCart before snapshotting the persisted cart', async () => {
  const cart = { items: [{ id: 'paid-item' }] };
  (useCartStore.getState as jest.Mock).mockImplementation(() => cart);
  const clearCart = jest.fn(async () => {
    await Promise.resolve();
    cart.items = [];
  });

  await clearAndPersistCheckoutCart(clearCart);

  expect(clearCart).toHaveBeenCalledTimes(1);
  expect(mockSetItem).toHaveBeenCalledWith(
    'cart-storage',
    JSON.stringify({
      state: { items: [] },
      version: 0,
    })
  );
});

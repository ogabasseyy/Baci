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
    subscribe: jest.fn(),
    persist: {
      getOptions: () => ({
        name: 'cart-storage',
        partialize: (state: { items: unknown[] }) => ({ items: state.items }),
        version: 0,
      }),
    },
  },
}));

const mockSubscribe = useCartStore.subscribe as jest.Mock;
const mockGetState = useCartStore.getState as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribe.mockImplementation(() => jest.fn());
});

it('snapshots the cleared cart once it empties', async () => {
  const cart = { items: [{ id: 'paid-item' }] };
  mockGetState.mockImplementation(() => cart);
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

it('persists without waiting for clearCart recovery cleanup to settle', async () => {
  const cart = { items: [{ id: 'paid-item' }] };
  mockGetState.mockImplementation(() => cart);
  let releaseClear!: () => void;
  const clearGate = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  const clearCart = jest.fn(async () => {
    await Promise.resolve();
    cart.items = [];
    await clearGate;
  });
  mockSubscribe.mockImplementation((listener: unknown) => {
    const notify = listener as (state: { items: unknown[] }) => void;
    const timer = setInterval(
      () => notify(useCartStore.getState() as { items: unknown[] }),
      0
    );
    return () => clearInterval(timer);
  });

  const pending = clearAndPersistCheckoutCart(clearCart);
  for (let i = 0; i < 100 && mockSetItem.mock.calls.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(mockSetItem).toHaveBeenCalledWith(
    'cart-storage',
    JSON.stringify({
      state: { items: [] },
      version: 0,
    })
  );
  releaseClear();
  await pending;
  expect(clearCart).toHaveBeenCalledTimes(1);
});

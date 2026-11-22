import { beforeEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '@/lib/logger';
import { trackError } from '@/services/analytics';
import { useCartStore } from '@/stores/cart-store';
import { deferredBankOfferCart } from './deferred-bank-offer-cart';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  getAllKeys: jest.fn(),
  getMany: jest.fn(),
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: jest.fn(),
    persist: { hasHydrated: jest.fn(() => true) },
  },
}));
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/services/analytics', () => ({ trackError: jest.fn() }));

const stored = new Map<string, string>();
const clearCart = jest.fn<() => Promise<void>>();
const item = { id: 'line-1', product_id: 'product-1', quantity: 1, price: 95 };
const reference = `BCO-${'a'.repeat(32)}`;
const otherReference = `BCO-${'b'.repeat(32)}`;
function cart(quantity = 1) {
  jest.mocked(useCartStore.getState).mockReturnValue({
    checkoutGeneration: 'generation-1',
    items: [{ ...item, quantity }],
    clearCart,
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  stored.clear();
  jest
    .mocked(AsyncStorage.getAllKeys)
    .mockImplementation(async () => [...stored.keys()]);
  cart();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async (key) => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation((key, value) => {
    stored.set(key, value);
    return Promise.resolve();
  });
  jest
    .mocked(AsyncStorage.getMany)
    .mockImplementation(async (keys) =>
      Object.fromEntries(keys.map((key) => [key, stored.get(key) ?? null]))
    );
});

export {
  AsyncStorage,
  cart,
  clearCart,
  deferredBankOfferCart,
  logger,
  otherReference,
  reference,
  stored,
  trackError,
  useCartStore,
};

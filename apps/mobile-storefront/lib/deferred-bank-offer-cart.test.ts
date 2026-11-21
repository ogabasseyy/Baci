import { beforeEach, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCartStore } from '@/stores/cart-store';
import { deferredBankOfferCart } from './deferred-bank-offer-cart';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: jest.fn(),
    persist: { hasHydrated: jest.fn(() => true) },
  },
}));

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
  cart();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async (key) => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
});

it('does not snapshot a cart before storage hydration', () => {
  jest.mocked(useCartStore.persist.hasHydrated).mockReturnValueOnce(false);
  expect(deferredBankOfferCart.capture()).toBeNull();
  expect(useCartStore.getState).not.toHaveBeenCalled();
});

it('does not use storage for a noncanonical bank offer reference', async () => {
  const malformedReference = reference.toLowerCase();
  await deferredBankOfferCart.remember(
    'order-1',
    malformedReference,
    'identity'
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    malformedReference,
    () => true
  );
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(clearCart).not.toHaveBeenCalled();
});

it('clears only the unchanged cart for the matching verified order and reference', async () => {
  const identity = deferredBankOfferCart.capture();
  expect(identity).not.toBeNull();
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    identity as string
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-2',
    reference,
    () => true
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    otherReference,
    () => true
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => false
  );
  jest.mocked(useCartStore.persist.hasHydrated).mockReturnValueOnce(false);
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();

  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).toHaveBeenCalledTimes(1);
});

it('keeps cart edits and does not replace the original marker on a repeat callback', async () => {
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    deferredBankOfferCart.capture() as string
  );
  cart(2);
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    deferredBankOfferCart.capture() as string
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    deferredBankOfferCart.capture() as string
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();
  expect([...stored.values()]).toEqual(['consumed']);
});

it('preserves the original marker for retry when clearing fails', async () => {
  const identity = deferredBankOfferCart.capture() as string;
  await deferredBankOfferCart.remember('order-1', reference, identity);
  clearCart.mockRejectedValueOnce(new Error('retryable cart write'));
  await expect(
    deferredBankOfferCart.clearIfUnchanged('order-1', reference, () => true)
  ).rejects.toThrow('retryable cart write');
  expect([...stored.values()]).toEqual([identity]);
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect([...stored.values()]).toEqual(['consumed']);
});

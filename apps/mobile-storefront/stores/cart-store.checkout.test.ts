import { useCartStore } from './cart-store';

jest.mock('../lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
}));

const item = {
  product_id: 'buds2',
  slug: 'buds2',
  name: 'Buds2',
  price: 85000,
  quantity: 1,
};

beforeEach(() => useCartStore.getState().clearCart());

it('persists the purchase generation with the cart for checkout remounts', () => {
  useCartStore.getState().addItem(item);
  const state = useCartStore.getState();
  const persisted = useCartStore.persist.getOptions().partialize?.(state);
  expect(persisted).toEqual(
    expect.objectContaining({
      checkoutGeneration: state.checkoutGeneration,
      items: state.items,
    })
  );
});

it('changes the purchase identity after clearing and buying the identical item', () => {
  useCartStore.getState().addItem(item);
  const first = useCartStore.getState().checkoutGeneration;
  useCartStore.getState().clearCart();
  expect(useCartStore.getState()).toEqual(
    expect.objectContaining({
      items: [],
      lineSequence: 0,
      cartWideNegotiationActive: false,
    })
  );
  expect(useCartStore.getState().checkoutGeneration).not.toBe(first);
  useCartStore.getState().addItem(item);
  expect(useCartStore.getState().checkoutGeneration).not.toBe(first);
});

it('changes identity when the shopper removes the last item and starts over', () => {
  useCartStore.getState().addItem(item);
  const { items, checkoutGeneration } = useCartStore.getState();
  useCartStore.getState().removeItem(items[0].id);
  useCartStore.getState().addItem(item);
  expect(useCartStore.getState().checkoutGeneration).not.toBe(
    checkoutGeneration
  );
});

it('restores the original retry identity when checkout fails after clearing the cart', () => {
  useCartStore.getState().addItem(item);
  const { items, checkoutGeneration } = useCartStore.getState();
  useCartStore.getState().clearCart();
  useCartStore.getState().restoreItems(items, false, checkoutGeneration);
  expect(useCartStore.getState().checkoutGeneration).toBe(checkoutGeneration);
  expect(useCartStore.getState().items).toEqual(items);
});

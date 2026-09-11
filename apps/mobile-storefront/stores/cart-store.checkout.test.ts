import { useCartStore } from './cart-store';

const persistedGeneration = { value: null as string | null };

jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: jest.fn(async (generation: string) => {
    persistedGeneration.value = generation;
  }),
}));
jest.mock('@/lib/read-persisted-checkout-generation', () => ({
  readPersistedCheckoutGeneration: jest.fn(
    async () => persistedGeneration.value
  ),
}));
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

const { persistCheckoutGeneration } =
  require('@/lib/persist-checkout-generation') as typeof import('@/lib/persist-checkout-generation');
const { readPersistedCheckoutGeneration } =
  require('@/lib/read-persisted-checkout-generation') as typeof import('@/lib/read-persisted-checkout-generation');

const item = {
  product_id: 'buds2',
  slug: 'buds2',
  name: 'Buds2',
  price: 85000,
  quantity: 1,
};

beforeEach(async () => {
  persistedGeneration.value = null;
  await useCartStore.getState().clearCart();
});

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

it('changes the purchase identity after clearing and buying the identical item', async () => {
  useCartStore.getState().addItem(item);
  const first = useCartStore.getState().checkoutGeneration;
  await useCartStore.getState().clearCart();
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

it('keeps a replacement item when last-item persist is still in flight', async () => {
  let releasePersist!: () => void;
  (persistCheckoutGeneration as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releasePersist = () => resolve();
      })
  );
  useCartStore.getState().addItem(item);
  const { items } = useCartStore.getState();
  const removing = useCartStore.getState().removeItem(items[0].id);
  useCartStore.getState().addItem(item);
  expect(useCartStore.getState().items).toHaveLength(1);
  releasePersist();
  await removing;
  expect(useCartStore.getState().items).toHaveLength(1);
});

it('changes identity when the shopper removes the last item and starts over', async () => {
  useCartStore.getState().addItem(item);
  const { items, checkoutGeneration } = useCartStore.getState();
  await useCartStore.getState().removeItem(items[0].id);
  useCartStore.getState().addItem(item);
  expect(useCartStore.getState().checkoutGeneration).not.toBe(
    checkoutGeneration
  );
});

it('keeps recovered generation when rebuilding an empty cart after a lost response', () => {
  useCartStore.setState({
    items: [],
    checkoutGeneration: '46ed63d7-5f10-49f0-9456-9ff571bec43f',
    lineSequence: 0,
  });
  useCartStore.getState().addItem(item);
  expect(useCartStore.getState().checkoutGeneration).toBe(
    '46ed63d7-5f10-49f0-9456-9ff571bec43f'
  );
});

it('starts a new retry identity when the shopper confirms a replacement checkout', async () => {
  useCartStore.getState().addItem(item);
  const first = useCartStore.getState().checkoutGeneration;
  await useCartStore.getState().advanceCheckoutGeneration();
  expect(useCartStore.getState().checkoutGeneration).not.toBe(first);
});

it('restores the original retry identity when checkout fails after clearing the cart', async () => {
  useCartStore.getState().addItem(item);
  const { items, checkoutGeneration } = useCartStore.getState();
  await useCartStore.getState().clearCart();
  await useCartStore.getState().restoreItems(items, false, checkoutGeneration);
  expect(useCartStore.getState().checkoutGeneration).toBe(checkoutGeneration);
  expect(useCartStore.getState().items).toEqual(items);
  expect(persistCheckoutGeneration).toHaveBeenCalledWith(checkoutGeneration);

  useCartStore.setState({ checkoutGeneration: 'stale-after-restart' });
  const recovered = await readPersistedCheckoutGeneration();
  if (recovered) {
    useCartStore.setState({ checkoutGeneration: recovered });
  }
  expect(useCartStore.getState().checkoutGeneration).toBe(checkoutGeneration);
});

it('does not keep a stale recovery generation after clearing the cart', async () => {
  useCartStore.getState().addItem(item);
  const first = useCartStore.getState().checkoutGeneration;
  persistedGeneration.value = first;
  await useCartStore.getState().clearCart();
  const recovered = await readPersistedCheckoutGeneration();
  if (recovered) {
    useCartStore.setState({ checkoutGeneration: recovered });
  }
  expect(recovered).not.toBe(first);
  expect(useCartStore.getState().checkoutGeneration).not.toBe(first);
});

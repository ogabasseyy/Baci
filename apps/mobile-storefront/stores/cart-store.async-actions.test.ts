import { jest } from '@jest/globals';

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
jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: jest.fn(async () => undefined),
  persistCheckoutGenerationDetached: jest.fn(),
}));
jest.mock('@/lib/read-persisted-checkout-generation', () => ({
  readPersistedCheckoutGeneration: jest.fn(async () => null),
}));

import { resetCartLineSequence, useCartStore } from './cart-store';

describe('cart-store async actions', () => {
  beforeEach(() => {
    resetCartLineSequence();
    useCartStore.setState({
      items: [],
      isLoading: false,
      lineSequence: 0,
      checkoutGeneration: 'legacy',
      cartWideNegotiationActive: false,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resets the group negotiation when an item is removed', async () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(270000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);
    expect(
      useCartStore
        .getState()
        .items.every((item) => item.negotiationStatus === 'accepted')
    ).toBe(true);

    const removeId = useCartStore.getState().items[0].id;
    await useCartStore.getState().removeItem(removeId);

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items[0].negotiatedPrice).toBeUndefined();
    expect(items[0].negotiationStatus).toBeUndefined();
  });

  it('resets the group negotiation when a line quantity changes', async () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(270000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Incrementing a line changes the cart total, so the distributed group deal
    // must reset rather than apply the old negotiated unit price to new units.
    const targetId = useCartStore.getState().items[0].id;
    await useCartStore.getState().updateQuantity(targetId, 3);

    const items = useCartStore.getState().items;
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items.every((item) => item.negotiatedPrice === undefined)).toBe(
      true
    );
    expect(items.find((item) => item.id === targetId)?.quantity).toBe(3);
  });

  it('resets the group negotiation when a new item is added', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(90000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Adding a line changes the cart composition, so the group deal resets and
    // existing lines revert to catalog price (no stale negotiated shares).
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items.every((item) => item.negotiatedPrice === undefined)).toBe(
      true
    );
  });

  it('clears the group negotiation on ALL lines when a reprice changes any line', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(270000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Only Item A's live price drifts, but the group total spanned both lines,
    // so both must lose their stale negotiated share — not just the drifted one.
    const [itemA, itemB] = useCartStore.getState().items;
    useCartStore.getState().repriceItems({ [itemA.id]: 120000 });

    const items = useCartStore.getState().items;
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items.every((item) => item.negotiatedPrice === undefined)).toBe(
      true
    );
    expect(items.every((item) => item.negotiationStatus === undefined)).toBe(
      true
    );
    // The drifted line took the live price; the other kept its base price.
    expect(items.find((item) => item.id === itemA.id)?.price).toBe(120000);
    expect(items.find((item) => item.id === itemB.id)?.price).toBe(200000);
  });

  it('keeps an individual negotiation on the remaining item when another is removed', async () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    const [itemA, itemB] = useCartStore.getState().items;
    useCartStore.getState().applyNegotiatedPrice(itemB.id, 195000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);

    await useCartStore.getState().removeItem(itemA.id);

    const remaining = useCartStore.getState().items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].negotiatedPrice).toBe(195000);
    expect(remaining[0].negotiationStatus).toBe('accepted');
  });

  it('restores the cart-wide negotiation flag alongside items on rollback', async () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    useCartStore.getState().applyCartWideNegotiation(90000);
    const snapshot = [...useCartStore.getState().items];
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Simulate a checkout that cleared the cart then failed and rolled back.
    await useCartStore.getState().clearCart();
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);

    await useCartStore.getState().restoreItems(snapshot, true);

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);
  });

  it('leaves the cart-wide flag untouched when restoreItems omits it', async () => {
    useCartStore.setState({ cartWideNegotiationActive: true });

    await useCartStore.getState().restoreItems([]);

    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);
  });
});

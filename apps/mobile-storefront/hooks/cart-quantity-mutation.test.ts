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
jest.mock('./cart-notifications', () => ({
  showCartToast: jest.fn(),
}));

import type { QueryClient } from '@tanstack/react-query';
import { resetCartLineSequence, useCartStore } from '../stores/cart-store';
import type { CartItem } from '../stores/cart-store.types';
import { createUpdateQuantityMutation } from './cart-quantity-mutation';

function line(overrides: Partial<CartItem> & { id: string }): CartItem {
  return {
    product_id: `product-${overrides.id}`,
    slug: `slug-${overrides.id}`,
    name: `Item ${overrides.id}`,
    price: 100,
    quantity: 1,
    ...overrides,
  };
}

function seed(items: CartItem[], cartWideNegotiationActive = false) {
  resetCartLineSequence();
  useCartStore.setState({
    items,
    isLoading: false,
    lineSequence: 0,
    checkoutGeneration: 'legacy',
    cartWideNegotiationActive,
  });
}

function mutation() {
  const { updateQuantity, restoreItems } = useCartStore.getState();
  return createUpdateQuantityMutation({
    queryClient: {} as QueryClient,
    updateQuantityInStore: updateQuantity,
    restoreItemsInStore: restoreItems,
  });
}

describe('cart quantity mutation rollback', () => {
  beforeEach(() => {
    seed([]);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('restores the previous quantity after a clamped optimistic write', () => {
    seed([line({ id: 'a', quantity: 1, max_quantity: 5 })]);
    const { onMutate, onError } = mutation();

    const context = onMutate({ id: 'a', quantity: 10 });
    // The store clamps the optimistic write to max_quantity.
    expect(useCartStore.getState().items[0]?.quantity).toBe(5);

    onError(
      new Error('Only 2 items available in stock'),
      { id: 'a', quantity: 10 },
      context
    );

    expect(useCartStore.getState().items[0]?.quantity).toBe(1);
  });

  it('restores group negotiation cleared by the optimistic write', () => {
    seed(
      [
        line({
          id: 'a',
          quantity: 1,
          negotiatedPrice: 90,
          negotiationStatus: 'accepted',
        }),
        line({
          id: 'b',
          quantity: 2,
          negotiatedPrice: 180,
          negotiationStatus: 'accepted',
        }),
      ],
      true
    );
    const { onMutate, onError } = mutation();

    const context = onMutate({ id: 'a', quantity: 3 });
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(useCartStore.getState().items[0]?.negotiatedPrice).toBeUndefined();

    onError(
      new Error('Only 1 items available in stock'),
      { id: 'a', quantity: 3 },
      context
    );

    const state = useCartStore.getState();
    expect(state.cartWideNegotiationActive).toBe(true);
    expect(state.items[0]).toMatchObject({
      quantity: 1,
      negotiatedPrice: 90,
      negotiationStatus: 'accepted',
    });
    expect(state.items[1]).toMatchObject({
      quantity: 2,
      negotiatedPrice: 180,
      negotiationStatus: 'accepted',
    });
  });

  it('leaves a newer concurrent edit alone', () => {
    seed([line({ id: 'a', quantity: 1 })]);
    const { onMutate, onError } = mutation();

    const context = onMutate({ id: 'a', quantity: 4 });
    // A newer keystroke edit lands before the stale failure arrives.
    useCartStore.getState().updateQuantity('a', 2);

    onError(
      new Error('Only 1 items available in stock'),
      { id: 'a', quantity: 4 },
      context
    );

    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });

  it('preserves a concurrently added line on rollback', () => {
    seed([line({ id: 'a', quantity: 1 })]);
    const { onMutate, onError } = mutation();

    const context = onMutate({ id: 'a', quantity: 4 });
    useCartStore.getState().addItem({
      product_id: 'product-b',
      slug: 'slug-b',
      name: 'Item b',
      price: 50,
      quantity: 1,
    });

    onError(
      new Error('Only 1 items available in stock'),
      { id: 'a', quantity: 4 },
      context
    );

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === 'a')?.quantity).toBe(1);
    expect(items.some((i) => i.product_id === 'product-b')).toBe(true);
  });

  it('leaves a concurrently removed line alone', () => {
    seed([line({ id: 'a', quantity: 1 }), line({ id: 'b', quantity: 1 })]);
    const { onMutate, onError } = mutation();

    const context = onMutate({ id: 'a', quantity: 4 });
    useCartStore.setState({
      items: useCartStore.getState().items.filter((i) => i.id !== 'a'),
    });

    onError(
      new Error('Only 1 items available in stock'),
      { id: 'a', quantity: 4 },
      context
    );

    expect(useCartStore.getState().items.map((i) => i.id)).toEqual(['b']);
  });
});

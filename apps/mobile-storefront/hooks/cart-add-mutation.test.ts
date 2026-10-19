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
jest.mock('./cart-stock', () => ({
  checkStock: jest.fn(),
  getExistingProductQuantityForStock: jest.fn(() => 0),
  getExistingCartQuantityForStock: jest.fn((item: { product_id: string }) => {
    const { useCartStore: store } =
      require('../stores/cart-store') as typeof import('../stores/cart-store');
    return store
      .getState()
      .items.filter(
        (cartItem: { product_id: string }) =>
          cartItem.product_id === item.product_id
      )
      .reduce(
        (total: number, cartItem: { quantity: number }) =>
          total + cartItem.quantity,
        0
      );
  }),
}));
jest.mock('./cart-query-cache', () => ({
  getCachedOptionStock: jest.fn(() => undefined),
}));

import type { QueryClient } from '@tanstack/react-query';
import type { MutableRefObject } from 'react';
import { resetCartLineSequence, useCartStore } from '../stores/cart-store';
import type { CartItem } from '../stores/cart-store.types';
import { createAddToCartMutation } from './cart-add-mutation';
import { showCartToast } from './cart-notifications';
import type { AddToCartInput } from './cart-stock';
import { checkStock } from './cart-stock';

const mockCheckStock = checkStock as unknown as jest.MockedFunction<
  typeof checkStock
>;
const mockToast = showCartToast as unknown as jest.Mock;

function seed(items: CartItem[]) {
  resetCartLineSequence();
  useCartStore.setState({
    items,
    isLoading: false,
    lineSequence: 0,
    checkoutGeneration: 'legacy',
    cartWideNegotiationActive: false,
  });
}

function input(overrides: Partial<AddToCartInput> = {}): AddToCartInput {
  return {
    product_id: 'product-1',
    slug: 'phone',
    name: 'Phone',
    price: 100,
    quantity: 2,
    ...overrides,
  };
}

function mutation() {
  const { addItem } = useCartStore.getState();
  return createAddToCartMutation({
    queryClient: { invalidateQueries: jest.fn() } as unknown as QueryClient,
    addItemToStore: addItem,
    pendingRollbacks: { current: new Map() } as MutableRefObject<
      Map<string, () => void>
    >,
    rollbackSequence: { current: 0 } as MutableRefObject<number>,
  });
}

beforeEach(() => {
  seed([]);
  mockCheckStock.mockResolvedValue({
    available: true,
    currentStock: 10,
    requestedQuantity: 2,
  } as never);
  mockToast.mockClear();
});

describe('cart add mutation', () => {
  it('applies the line optimistically and validates the post-write total', async () => {
    const options = mutation();
    const item = input();
    const context = options.onMutate(item);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(context.rollbackId).toContain('product-1');

    await options.mutationFn(item);
    expect(mockCheckStock).toHaveBeenCalledWith(
      'product-1',
      2,
      undefined,
      expect.objectContaining({ aggregateQuantity: 0 })
    );
  });

  it('rolls back only its own contribution when a sibling add lands first', () => {
    const options = mutation();
    const item = input({ quantity: 2 });
    const context = options.onMutate(item);
    // Concurrent successful add to the same line.
    useCartStore.getState().addItem(input({ quantity: 5 }));
    expect(useCartStore.getState().items[0].quantity).toBe(7);

    options.onError(
      new Error('Only 3 items available in stock'),
      item,
      context
    );
    expect(useCartStore.getState().items[0].quantity).toBe(5);
    expect(mockToast).toHaveBeenCalledWith(
      'Only 3 items available in stock',
      'error'
    );
  });

  it('removes the optimistic line when the whole contribution fails', () => {
    const options = mutation();
    const item = input({ quantity: 2 });
    const context = options.onMutate(item);

    options.onError(
      new Error('Only 0 items available in stock'),
      item,
      context
    );
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('leaves a concurrently removed line alone instead of resurrecting it', () => {
    const options = mutation();
    const item = input({ quantity: 2 });
    const context = options.onMutate(item);
    useCartStore.getState().removeItem(useCartStore.getState().items[0].id);

    options.onError(
      new Error('Only 0 items available in stock'),
      item,
      context
    );
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});

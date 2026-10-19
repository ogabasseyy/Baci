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
  // Faithful identity-total seam: the real aggregation (duplicate
  // lines, voucher exclusion) is unit-tested in cart-stock.test.ts;
  // here the mutation must call it with the edited item and pass
  // its return to checkStock as the validated quantity.
  getExistingCartQuantityForStock: jest.fn(
    (item: {
      product_id: string;
      variant_id?: string | null;
      offer_id?: string | null;
    }) => {
      const { useCartStore: store } =
        require('../stores/cart-store') as typeof import('../stores/cart-store');
      const variantId = item.variant_id ?? null;
      const offerId = item.offer_id ?? null;
      return store.getState().items.reduce(
        (
          total: number,
          cartItem: {
            product_id: string;
            variant_id?: string | null;
            offer_id?: string | null;
            quantity: number;
            voucher_token?: string;
            voucher_award_id?: string;
          }
        ) =>
          !cartItem.voucher_token &&
          !cartItem.voucher_award_id &&
          cartItem.product_id === item.product_id &&
          (cartItem.variant_id ?? null) === variantId &&
          (cartItem.offer_id ?? null) === offerId
            ? total + cartItem.quantity
            : total,
        0
      );
    }
  ),
}));
jest.mock('./cart-query-cache', () => ({
  getCachedOptionStock: jest.fn(() => undefined),
}));

import type { QueryClient } from '@tanstack/react-query';
import { resetCartLineSequence, useCartStore } from '../stores/cart-store';
import type { CartItem } from '../stores/cart-store.types';
import { createUpdateQuantityMutation } from './cart-quantity-mutation';
import { resetQuantityValidationFlightsForTests } from './cart-quantity-validation-flights';
import { checkStock } from './cart-stock';

const mockCheckStock = checkStock as unknown as jest.MockedFunction<
  typeof checkStock
>;

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

function mutation(queryClient = {} as QueryClient) {
  const { updateQuantity, restoreItems } = useCartStore.getState();
  return createUpdateQuantityMutation({
    queryClient,
    updateQuantityInStore: updateQuantity,
    restoreItemsInStore: restoreItems,
  });
}

describe('cart quantity mutation rollback', () => {
  beforeEach(() => {
    seed([]);
    resetQuantityValidationFlightsForTests();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('restores the previous quantity after a clamped optimistic write', () => {
    seed([line({ id: 'a', quantity: 1, max_quantity: 5 })]);
    const { onMutate, onError, onSettled } = mutation();

    const context = onMutate({ id: 'a', quantity: 10 });
    // The store clamps the optimistic write to max_quantity.
    expect(useCartStore.getState().items[0]?.quantity).toBe(5);

    const error = new Error('Only 2 items available in stock');
    onError(error, { id: 'a', quantity: 10 }, context);
    onSettled(undefined, error, { id: 'a', quantity: 10 });

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
    const { onMutate, onError, onSettled } = mutation();

    const context = onMutate({ id: 'a', quantity: 3 });
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(useCartStore.getState().items[0]?.negotiatedPrice).toBeUndefined();

    const error = new Error('Only 1 items available in stock');
    onError(error, { id: 'a', quantity: 3 }, context);
    onSettled(undefined, error, { id: 'a', quantity: 3 });

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
    const { onMutate, onError, onSettled } = mutation();

    const context = onMutate({ id: 'a', quantity: 4 });
    // A newer keystroke edit lands before the stale failure arrives.
    useCartStore.getState().updateQuantity('a', 2);

    const error = new Error('Only 1 items available in stock');
    onError(error, { id: 'a', quantity: 4 }, context);
    onSettled(undefined, error, { id: 'a', quantity: 4 });

    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });

  it('preserves a concurrently added line on rollback', () => {
    seed([line({ id: 'a', quantity: 1 })]);
    const { onMutate, onError, onSettled } = mutation();

    const context = onMutate({ id: 'a', quantity: 4 });
    useCartStore.getState().addItem({
      product_id: 'product-b',
      slug: 'slug-b',
      name: 'Item b',
      price: 50,
      quantity: 1,
    });

    const error = new Error('Only 1 items available in stock');
    onError(error, { id: 'a', quantity: 4 }, context);
    onSettled(undefined, error, { id: 'a', quantity: 4 });

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === 'a')?.quantity).toBe(1);
    expect(items.some((i) => i.product_id === 'product-b')).toBe(true);
  });

  it('leaves a concurrently removed line alone', () => {
    seed([line({ id: 'a', quantity: 1 }), line({ id: 'b', quantity: 1 })]);
    const { onMutate, onError, onSettled } = mutation();

    const context = onMutate({ id: 'a', quantity: 4 });
    useCartStore.setState({
      items: useCartStore.getState().items.filter((i) => i.id !== 'a'),
    });

    const error = new Error('Only 1 items available in stock');
    onError(error, { id: 'a', quantity: 4 }, context);
    onSettled(undefined, error, { id: 'a', quantity: 4 });

    expect(useCartStore.getState().items.map((i) => i.id)).toEqual(['b']);
  });

  it('rolls overlapping invalid edits back to the validated quantity', () => {
    seed([line({ id: 'a', quantity: 1 })]);
    const { onMutate, onError, onSettled } = mutation();

    // Stock holds 1 unit; two invalid edits overlap (1->2, then 2->3).
    const first = onMutate({ id: 'a', quantity: 2 });
    const second = onMutate({ id: 'a', quantity: 3 });

    // The first rejection settles first and is skipped (the line moved
    // on); the second must restore 1 — never its own unvalidated
    // predecessor 2.
    const firstError = new Error('Only 1 items available in stock');
    onError(firstError, { id: 'a', quantity: 2 }, first);
    onSettled(undefined, firstError, { id: 'a', quantity: 2 });
    const secondError = new Error('Only 1 items available in stock');
    onError(secondError, { id: 'a', quantity: 3 }, second);
    onSettled(undefined, secondError, { id: 'a', quantity: 3 });

    expect(useCartStore.getState().items[0]?.quantity).toBe(1);
  });

  it('advances the rollback baseline when an overlapping edit succeeds', () => {
    seed([line({ id: 'a', quantity: 1, product_id: 'p1' })]);
    const invalidateQueries = jest.fn();
    const { onMutate, onError, onSettled, onSuccess } = mutation({
      invalidateQueries,
    } as unknown as QueryClient);

    onMutate({ id: 'a', quantity: 2 });
    const second = onMutate({ id: 'a', quantity: 3 });

    // The first edit validates 2 units; the overlapping second edit
    // then fails and must restore the validated 2, not the stale 1.
    const success = {
      id: 'a',
      quantity: 2,
      stockCheck: { available: true, currentStock: 2 },
    };
    onSuccess(success as never);
    onSettled(success as never, null, { id: 'a', quantity: 2 });

    const error = new Error('Only 2 items available in stock');
    onError(error, { id: 'a', quantity: 3 }, second);
    onSettled(undefined, error, { id: 'a', quantity: 3 });

    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });
});

describe('cart quantity mutation validation', () => {
  beforeEach(() => {
    seed([]);
    resetQuantityValidationFlightsForTests();
    jest.clearAllMocks();
  });

  it('validates the clamped store quantity, not the raw request', async () => {
    seed([line({ id: 'a', product_id: 'p1', quantity: 1, max_quantity: 5 })]);
    const { onMutate, mutationFn } = mutation();

    // onMutate runs first (react-query order) and clamps the store to 5.
    onMutate({ id: 'a', quantity: 10 });
    expect(useCartStore.getState().items[0]?.quantity).toBe(5);

    // Live stock covers the clamped 5 but not the raw 10: validation
    // must pass against the applied quantity.
    mockCheckStock.mockImplementation(
      async (_productId: unknown, requested: unknown) => ({
        available: (requested as number) <= 5,
        currentStock: 5,
        requestedQuantity: requested as number,
      })
    );

    const result = await mutationFn({ id: 'a', quantity: 10 });

    expect(mockCheckStock).toHaveBeenCalledWith(
      'p1',
      5,
      undefined,
      expect.objectContaining({ aggregateQuantity: 0 })
    );
    expect(result).toEqual({
      id: 'a',
      quantity: 5,
      stockCheck: {
        available: true,
        currentStock: 5,
        requestedQuantity: 5,
      },
    });
  });

  it('rejects when live stock does not cover the clamped quantity', async () => {
    seed([line({ id: 'a', product_id: 'p1', quantity: 1, max_quantity: 5 })]);
    const { onMutate, mutationFn } = mutation();

    onMutate({ id: 'a', quantity: 10 });
    mockCheckStock.mockResolvedValue({
      available: false,
      currentStock: 2,
      requestedQuantity: 5,
    });

    await expect(mutationFn({ id: 'a', quantity: 10 })).rejects.toThrow(
      'Only 2 items available in stock'
    );
  });

  it('validates the post-write identity total across duplicate offer lines', async () => {
    // Two lines share one exact offer (legacy alias adoption): the
    // edited line alone fits the 3-unit allocation, but the joint
    // total of 4 must fail validation.
    seed([
      line({ id: 'a', product_id: 'p1', offer_id: 'offer-1', quantity: 2 }),
      line({ id: 'b', product_id: 'p1', offer_id: 'offer-1', quantity: 2 }),
    ]);
    const { onMutate, mutationFn } = mutation();

    onMutate({ id: 'a', quantity: 2 });
    mockCheckStock.mockImplementation(
      async (_productId: unknown, requested: unknown) => ({
        available: (requested as number) <= 3,
        currentStock: 3,
        requestedQuantity: requested as number,
      })
    );

    await expect(mutationFn({ id: 'a', quantity: 2 })).rejects.toThrow(
      'Only 3 items available in stock'
    );
    expect(mockCheckStock).toHaveBeenCalledWith(
      'p1',
      4,
      undefined,
      expect.objectContaining({ offerId: 'offer-1' })
    );
  });

  it('reapplies a late validated quantity after a newer rollback', () => {
    seed([line({ id: 'a', quantity: 1, product_id: 'p1' })]);
    const invalidateQueries = jest.fn();
    const { onMutate, onError, onSettled, onSuccess } = mutation({
      invalidateQueries,
    } as unknown as QueryClient);

    // 1 -> 2 -> 3 with the newer edit (3) failing first: its
    // rollback restores the shared baseline 1.
    onMutate({ id: 'a', quantity: 2 });
    const second = onMutate({ id: 'a', quantity: 3 });
    const error = new Error('Only 2 items available in stock');
    onError(error, { id: 'a', quantity: 3 }, second);
    onSettled(undefined, error, { id: 'a', quantity: 3 });
    expect(useCartStore.getState().items[0]?.quantity).toBe(1);

    // The older validation for 2 lands late: 2 passed stock
    // validation, so the cart must show 2, not the stale rollback 1.
    const success = {
      id: 'a',
      quantity: 2,
      stockCheck: { available: true, currentStock: 2 },
    };
    onSuccess(success as never);
    onSettled(success as never, null, { id: 'a', quantity: 2 });

    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });

  it('never clobbers a still-newer edit on late success', () => {
    seed([line({ id: 'a', quantity: 1, product_id: 'p1' })]);
    const invalidateQueries = jest.fn();
    const { onMutate, onError, onSettled, onSuccess } = mutation({
      invalidateQueries,
    } as unknown as QueryClient);

    onMutate({ id: 'a', quantity: 2 });
    const second = onMutate({ id: 'a', quantity: 3 });
    const error = new Error('Only 2 items available in stock');
    onError(error, { id: 'a', quantity: 3 }, second);
    onSettled(undefined, error, { id: 'a', quantity: 3 });

    // A third keystroke edit lands before the late success arrives.
    const third = onMutate({ id: 'a', quantity: 4 });
    expect(useCartStore.getState().items[0]?.quantity).toBe(4);

    const success = {
      id: 'a',
      quantity: 2,
      stockCheck: { available: true, currentStock: 2 },
    };
    onSuccess(success as never);
    onSettled(success as never, null, { id: 'a', quantity: 2 });

    // The line moved off the rollback baseline, so the late
    // success only advances the baseline and leaves 4 in place.
    expect(useCartStore.getState().items[0]?.quantity).toBe(4);
    expect(third.appliedQuantity).toBe(4);
  });
});

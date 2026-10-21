import type { CartSnapshot } from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import { createNativeCartController } from './controller';
import {
  type CheckoutCartState,
  prepareCartCheckout,
} from './prepare-cart-checkout';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
it('recovers a cached used laptop through checkout with authoritative server pricing', async () => {
  const merchant = '11111111-1111-4111-8111-111111111111';
  const product = '33333333-3333-4333-8333-333333333333';
  const cartId = '22222222-2222-4222-8222-222222222222';
  const cached: CartItem[] = [
    {
      id: 'local-laptop',
      product_id: product,
      slug: 'laptop',
      name: 'MacBook',
      price: 1320000,
      quantity: 1,
      condition: 'USED',
    },
  ];
  const snapshot: CartSnapshot = {
    merchantId: merchant,
    cartId,
    version: 1,
    state: 'active',
    currency: 'NGN',
    lines: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        item: { productId: product, condition: 'used' },
        quantity: 1,
        unitPriceMinor: 120000000,
        lineTotalMinor: 120000000,
      },
    ],
    subtotalMinor: 120000000,
    totalMinor: 120000000,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  let context: { actor: string; cartId: string | null } | null = null;
  const client = {
    context: jest.fn(async () => context),
    bootstrap: jest.fn(async () => {
      context = { actor: 'guest', cartId: null };
      return { proof: 'test-proof' };
    }),
    read: jest.fn().mockResolvedValue({ cart: snapshot }),
    create: jest.fn(async () => {
      context = { actor: 'guest', cartId };
      return { cart: snapshot };
    }),
    command: jest.fn(),
    recoverCreation: jest.fn().mockResolvedValue(null),
  };
  const receipts = {
    read: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  let state: CheckoutCartState = {
    enabled: true,
    status: 'loading',
    metadataReady: false,
    snapshot: null,
    prepare: null,
    refresh: null,
  };
  const publish = jest.fn(
    (
      next: CartSnapshot,
      display: { items: CartItem[]; metadataReady: boolean }
    ) => {
      state = {
        ...state,
        snapshot: next,
        metadataReady: display.metadataReady,
      };
    }
  );
  const controller = createNativeCartController({
    merchantId: merchant,
    client,
    receipts,
    newOperationId: () => '55555555-5555-4555-8555-555555555555',
    getLegacy: () => ({ items: cached }),
    loadProduct: async () => ({ id: product, slug: 'laptop', name: 'MacBook' }),
    publish,
    status: (status) => {
      state = { ...state, status };
    },
    isCurrent: () => true,
  });
  state.prepare = controller.prepare;
  state.refresh = controller.refresh;
  await controller.refresh();
  expect(state.status).toBe('ready');
  expect(state.snapshot).toBeNull();
  expect(client.create).not.toHaveBeenCalled();
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: true,
  });
  expect(client.create).toHaveBeenCalledWith(
    expect.objectContaining({
      lines: [
        expect.objectContaining({
          item: { productId: product, condition: 'used' },
          quantity: 1,
        }),
      ],
    })
  );
  expect(publish.mock.calls[0][1].items[0].price).toBe(1200000);
  expect(receipts.save).toHaveBeenCalledTimes(1);
  expect(receipts.clear).toHaveBeenCalledTimes(1);
});

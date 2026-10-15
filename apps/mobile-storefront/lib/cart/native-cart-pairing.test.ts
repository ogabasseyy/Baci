import { pairNativeCart } from './native-cart-pairing';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const productA = '33333333-3333-4333-8333-333333333333';
const productB = '44444444-4444-4444-8444-444444444444';
const line = (productId: string) => ({
  id: productId,
  item: { productId },
  quantity: 1,
  unitPriceMinor: 100,
  lineTotalMinor: 100,
});
const existing = {
  merchantId,
  cartId,
  version: 3,
  state: 'active' as const,
  currency: 'NGN',
  expiresAt: '2099-01-01T00:00:00Z',
  subtotalMinor: 100,
  totalMinor: 100,
  estimatedTotals: false,
  lines: [line(productA)],
};
it('submits the complete two-cart union with both reviewed versions', async () => {
  const incoming = {
    ...existing,
    cartId: '55555555-5555-4555-8555-555555555555',
    version: 7,
    lines: [line(productB)],
  };
  const redeem = jest.fn().mockResolvedValue(existing);
  const onMergeConflicts = jest.fn();
  await pairNativeCart(
    {
      merchantId,
      client: {
        context: jest.fn().mockResolvedValue({ actor: 'guest', cartId }),
        bootstrap: jest.fn(),
        previewHandoff: jest.fn().mockResolvedValue({
          snapshot: incoming,
          expiresAt: incoming.expiresAt,
        }),
        redeem: jest.fn(),
      },
      readPending: async () => null,
      getSnapshot: () => existing,
      getItems: () => [],
      ensureCart: async () => existing,
      refresh: async () => {},
      accept: jest.fn(),
      assertCurrent: jest.fn(),
      pending: jest.fn(),
      onMergeConflicts,
      newOperationId: () => 'same-attempt',
      redeem,
    },
    {
      merchantId,
      token: 'ch1.payload.signature',
      handoffId: incoming.cartId,
      destination: 'native',
      browserUrl: 'https://shop.example/cart',
    },
    'merge'
  );
  expect(onMergeConflicts).toHaveBeenCalledWith([], undefined);
  expect(redeem).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedDestVersion: 3,
      expectedIncomingVersion: 7,
      attemptId: 'same-attempt',
      lines: [
        expect.objectContaining({ item: { productId: productA } }),
        expect.objectContaining({ item: { productId: productB } }),
      ],
    })
  );
});
it('completes keep_existing without a destination cart and adopts nothing', async () => {
  const accept = jest.fn();
  const onHandoffCommitted = jest.fn();
  const redeem = jest.fn().mockResolvedValue(null);
  await pairNativeCart(
    {
      merchantId,
      client: {
        context: jest.fn().mockResolvedValue({ actor: 'guest', cartId: null }),
        bootstrap: jest.fn(),
        previewHandoff: jest.fn().mockResolvedValue({
          snapshot: existing,
          expiresAt: existing.expiresAt,
        }),
        redeem: jest.fn(),
      },
      readPending: async () => null,
      getSnapshot: () => null,
      getItems: () => [],
      ensureCart: async () => existing,
      refresh: async () => {},
      accept,
      assertCurrent: jest.fn(),
      pending: jest.fn(),
      newOperationId: () => 'keep-attempt',
      onHandoffCommitted,
      redeem,
    },
    {
      merchantId,
      token: 'ch1.payload.signature',
      handoffId: existing.cartId,
      destination: 'native',
      browserUrl: 'https://shop.example/cart',
    },
    'keep_existing'
  );
  expect(redeem).toHaveBeenCalledWith(
    expect.objectContaining({ choice: 'keep_existing' })
  );
  expect(accept).not.toHaveBeenCalled();
  expect(onHandoffCommitted).toHaveBeenCalledWith(existing.cartId);
});

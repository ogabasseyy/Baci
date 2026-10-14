import type { CartItem } from '@/stores/cart-store.types';
import { createNativeCartController } from './controller';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const merchant = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const snapshot = {
  merchantId: merchant,
  cartId,
  version: 1,
  state: 'active' as const,
  currency: 'NGN',
  lines: [],
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
};
function setup() {
  let context: { actor: string; cartId: string | null } | null = null;
  const client = {
    context: jest.fn(async () => context),
    bootstrap: jest.fn(async () => {
      context = { actor: 'guest', cartId: null };
      return { proof: 'cp1.a.sig' };
    }),
    read: jest.fn().mockResolvedValue({ cart: snapshot }),
    create: jest.fn(async () => {
      context = { actor: 'guest', cartId };
      return { cart: snapshot };
    }),
    command: jest.fn(async (input: { expectedVersion: number }) => ({
      cart: { ...snapshot, version: input.expectedVersion + 1 },
    })),
    recoverCreation: jest.fn().mockResolvedValue(null),
    restartSession: jest.fn(async () => ({ proof: 'cp1.b.sig' })),
  };
  const receipts = {
    read: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const getLegacy = jest.fn(() => ({
    items: [] as CartItem[],
    sharedCartRef: undefined,
  }));
  const onMergeConflicts = jest.fn();
  const publish = jest.fn();
  const status = jest.fn();
  const controller = createNativeCartController({
    merchantId: merchant,
    client,
    receipts,
    newOperationId: (() => {
      let next = 0;
      return () => `key-${++next}`;
    })(),
    getLegacy,
    onMergeConflicts,
    loadProduct: async () => null,
    publish,
    status,
    isCurrent: () => true,
  });
  return {
    client,
    receipts,
    publish,
    status,
    controller,
    getLegacy,
    onMergeConflicts,
    connect: () => {
      context = { actor: 'guest', cartId };
    },
  };
}
it('treats a completed cart as finished and starts a fresh cart on the next write', async () => {
  const s = setup();
  s.connect();
  s.client.read.mockResolvedValue({
    cart: { ...snapshot, state: 'completed' as const },
  });
  const restart = s.client.restartSession;
  await s.controller.refresh();
  expect(s.publish).toHaveBeenCalledWith(
    expect.objectContaining({ state: 'completed' }),
    expect.objectContaining({ items: [] })
  );
  s.client.context.mockResolvedValue({ actor: 'guest', cartId: null });
  s.client.read.mockResolvedValue({ cart: snapshot });
  await s.controller.write({ type: 'clear' });
  expect(restart).toHaveBeenCalledTimes(1);
  expect(s.client.create).toHaveBeenCalledTimes(1);
});
it('clears the display for an expired cart instead of offering it for checkout', async () => {
  const s = setup();
  s.connect();
  s.client.read.mockResolvedValue({
    cart: { ...snapshot, state: 'expired' as const },
  });
  await expect(s.controller.refresh()).resolves.not.toThrow();
  expect(s.publish).toHaveBeenCalledWith(
    expect.objectContaining({ state: 'expired' }),
    expect.objectContaining({ items: [] })
  );
  expect(s.status).toHaveBeenCalledWith('ready');
});
it('does not create authority or carts during initialization without a proof', async () => {
  const s = setup();
  await s.controller.refresh();
  expect(s.client.bootstrap).not.toHaveBeenCalled();
  expect(s.client.create).not.toHaveBeenCalled();
});
it('lazily provisions on intent and serializes later commands against confirmed versions', async () => {
  const s = setup();
  await s.controller.write({ type: 'clear' });
  await Promise.all([
    s.controller.write({ type: 'clear' }),
    s.controller.write({ type: 'clear' }),
  ]);
  expect(s.client.bootstrap).toHaveBeenCalledTimes(1);
  expect(s.client.create).toHaveBeenCalledTimes(1);
  expect(
    s.client.command.mock.calls.map(([input]) => input.expectedVersion)
  ).toEqual([1, 2, 3]);
});
it('does not turn a failed authorized read into an empty or replacement cart', async () => {
  const s = setup();
  s.connect();
  s.client.read.mockRejectedValue(new Error('outage'));
  await expect(s.controller.refresh()).rejects.toThrow();
  await expect(s.controller.write({ type: 'clear' })).rejects.toThrow();
  expect(s.client.create).not.toHaveBeenCalled();
  expect(s.publish).not.toHaveBeenCalled();
});
it('does not bootstrap a new principal over unresolved durable intent', async () => {
  const s = setup();
  s.receipts.read.mockResolvedValue({
    actor: 'old',
    operationId: 'old-key',
    body: {},
  });
  await expect(s.controller.write({ type: 'clear' })).rejects.toThrow();
  expect(s.client.bootstrap).not.toHaveBeenCalled();
});
it('requires explicit native pairing and previews before creating guest authority', async () => {
  const s = setup();
  const previewHandoff = jest
    .fn()
    .mockResolvedValue({ snapshot, expiresAt: '2099-01-01T00:00:00Z' });
  const redeem = jest.fn().mockResolvedValue({ cart: snapshot });
  Object.assign(s.client, { previewHandoff, redeem });
  const link = {
    merchantId: merchant,
    handoffId: cartId,
    token: 'ch1.payload.signature',
    destination: 'native' as const,
    browserUrl: 'https://shop.example/cart',
  };
  await expect(
    s.controller.pair({ ...link, destination: 'web' }, 'connect')
  ).rejects.toThrow();
  expect(s.client.bootstrap).not.toHaveBeenCalled();
  await s.controller.pair(link, 'connect');
  expect(previewHandoff.mock.invocationCallOrder[0]).toBeLessThan(
    s.client.bootstrap.mock.invocationCallOrder[0]
  );
  expect(s.client.create).not.toHaveBeenCalled();
  expect(redeem).toHaveBeenCalledWith(
    expect.objectContaining({
      token: link.token,
      handoffId: cartId,
      expectedIncomingVersion: 1,
      choice: 'connect',
    })
  );
});
it('fetches current state after replaying a historical mutation receipt', async () => {
  const s = setup();
  s.connect();
  s.receipts.read.mockResolvedValue({
    actor: 'guest',
    operationId: 'replayed',
    body: {
      kind: 'command',
      cartId,
      input: {
        operationId: 'replayed',
        expectedVersion: 1,
        command: { type: 'clear' },
      },
    },
  });
  s.client.read.mockResolvedValue({ cart: { ...snapshot, version: 7 } });
  await s.controller.refresh();
  expect(s.publish.mock.calls.at(-1)?.[0].version).toBe(7);
  expect(s.client.read).toHaveBeenCalledWith(cartId);
});

it('does not block an already confirmed cart during background refresh', async () => {
  const s = setup();
  s.connect();
  await s.controller.refresh();
  s.status.mockClear();
  await s.controller.refresh();
  expect(s.status).not.toHaveBeenCalledWith('loading');
});
it('clears outstanding merge choices only after a successful explicit selection', async () => {
  const s = setup();
  s.connect();
  s.getLegacy.mockReturnValue({
    items: [
      {
        id: 'local',
        product_id: 'local',
        name: 'Phone',
        slug: 'phone',
        quantity: 1,
        price: 100,
      } as CartItem,
    ],
    sharedCartRef: undefined,
  });
  await expect(s.controller.refresh()).rejects.toThrow();
  expect(s.onMergeConflicts).not.toHaveBeenCalled();
  await s.controller.chooseLegacy('keep_server');
  expect(s.onMergeConflicts).toHaveBeenCalledWith([], undefined);
});

import {
  nativeHandoffRedeemSchema,
  pendingCartBodySchema,
} from '@/schemas/cart-pending-request';
import { createCartCommandCoordinator } from './command-coordinator';
import { NativeCartError } from './native-cart-error';
import { pairNativeCart } from './native-cart-pairing';
import type { PendingCartRequest } from './pending-request';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const ref = (n: number) => ({
  sourceLineId: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`,
  item: { productId },
  quantity: (n % 10) + 1,
  hasAssurance: n % 2 === 0,
});
const input = {
  token: 'ch1.payload.signature',
  handoffId: cartId,
  attemptId: 'exact-attempt',
  choice: 'merge' as const,
  destCartId: cartId,
  expectedIncomingVersion: 7,
  expectedDestVersion: 4,
  lines: Array.from({ length: 40 }, (_, n) => ref(n)),
};

it('persists all forty exact stored references and replays them unchanged after restart', async () => {
  let pending: PendingCartRequest | null = null;
  const receipts = {
    read: jest.fn(async () => pending),
    save: jest.fn(async (_merchant: string, request: PendingCartRequest) => {
      pending = JSON.parse(JSON.stringify(request)) as PendingCartRequest;
    }),
    clear: jest.fn(async () => {
      pending = null;
    }),
  };
  const cart = {
    cartId,
    merchantId,
    version: 5,
    state: 'active' as const,
    currency: 'NGN',
    lines: [],
    subtotalMinor: 0,
    totalMinor: 0,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const redeem = jest
    .fn()
    .mockRejectedValueOnce(new NativeCartError('temporarily_unavailable', true))
    .mockResolvedValue({ cart });
  const options = {
    merchantId,
    receipts,
    getActor: async () => 'same-device',
    isCurrent: () => true,
    onSnapshot: jest.fn(),
    client: { create: jest.fn(), command: jest.fn(), redeem },
  };
  await expect(
    createCartCommandCoordinator(options).redeem(input)
  ).rejects.toMatchObject({ indeterminate: true });
  expect(receipts.save).toHaveBeenCalledWith(merchantId, {
    actor: 'same-device',
    operationId: input.attemptId,
    body: { kind: 'handoff', input },
  });
  expect(receipts.clear).not.toHaveBeenCalled();
  await createCartCommandCoordinator(options).recover();
  expect(redeem).toHaveBeenNthCalledWith(1, input);
  expect(redeem).toHaveBeenNthCalledWith(2, input);
  expect(receipts.clear).toHaveBeenCalledWith(merchantId, input.attemptId);
});

it('preserves reference IDs and assurance through the handoff-only schema', () => {
  expect(
    nativeHandoffRedeemSchema.parse({ ...input, lines: [ref(1), ref(2)] }).lines
  ).toEqual([ref(1), ref(2)]);
});
it('rejects invalid reference IDs and forty-one submitted references', () => {
  expect(
    nativeHandoffRedeemSchema.safeParse({
      ...input,
      lines: [{ ...ref(1), sourceLineId: 'invalid' }],
    }).success
  ).toBe(false);
  expect(
    nativeHandoffRedeemSchema.safeParse({
      ...input,
      lines: [...input.lines, ref(41)],
    }).success
  ).toBe(false);
});
it('keeps ordinary account and replacement commands capped at twenty lines', () => {
  const lines = input.lines
    .slice(0, 21)
    .map(({ item, quantity }) => ({ item, quantity }));
  expect(
    pendingCartBodySchema.safeParse({
      kind: 'command',
      cartId,
      input: {
        operationId: 'command',
        expectedVersion: 1,
        command: { type: 'replace', lines },
      },
    }).success
  ).toBe(false);
  expect(
    pendingCartBodySchema.safeParse({
      kind: 'account',
      ownerSubject: merchantId,
      input: { operationId: 'account', choice: 'merge', lines },
    }).success
  ).toBe(false);
});

const productA = productId;
const productB = '55555555-5555-4555-8555-555555555555';
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
  lines: [line(productId)],
};

it('submits every stored source and destination lane ID from a redacted sibling preview', async () => {
  const regular = {
    ...line(productA),
    id: '66666666-6666-4666-8666-666666666666',
    quantity: 2,
  };
  const voucher = {
    ...line(productA),
    id: '77777777-7777-4777-8777-777777777777',
    quantity: 1,
    hasAssurance: true,
  };
  const sourceRegular = {
    ...regular,
    id: '88888888-8888-4888-8888-888888888888',
    quantity: 3,
  };
  const current = {
    ...existing,
    lines: [
      {
        ...regular,
        negotiatedUnitPriceMinor: 75,
        negotiationStatus: 'accepted' as const,
      },
    ],
  };
  const incoming = {
    ...existing,
    cartId: productB,
    lines: [sourceRegular, voucher],
  };
  const redeem = jest.fn().mockResolvedValue(current);
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
      getSnapshot: () => current,
      getItems: () => [],
      ensureCart: async () => current,
      refresh: async () => {},
      accept: jest.fn(),
      assertCurrent: jest.fn(),
      pending: jest.fn(),
      newOperationId: () => 'refs-attempt',
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
  expect(redeem).toHaveBeenCalledWith(
    expect.objectContaining({
      lines: [
        {
          sourceLineId: regular.id,
          item: regular.item,
          quantity: regular.quantity,
        },
        {
          sourceLineId: sourceRegular.id,
          item: sourceRegular.item,
          quantity: sourceRegular.quantity,
        },
        {
          sourceLineId: voucher.id,
          item: voucher.item,
          quantity: voucher.quantity,
          hasAssurance: true,
        },
      ],
    })
  );
  expect(JSON.stringify(redeem.mock.calls[0][0])).not.toContain('voucherToken');
  expect(JSON.stringify(redeem.mock.calls[0][0])).not.toContain(
    'negotiatedUnitPriceMinor'
  );
});

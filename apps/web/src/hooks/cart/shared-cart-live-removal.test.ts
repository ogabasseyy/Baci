import { expect, it, vi } from 'vitest';
import {
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import { removeCapacityLineFromLiveCart } from './shared-cart-live-removal';
import { cartItem } from './shared-cart-provisioning.test-support';

vi.mock('./shared-cart-client', () => ({
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

const snapshot = (quantity: number, version = 3) => ({
  ok: true as const,
  snapshot: {
    cartId: 'cart-1',
    currency: 'NGN',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    lines: [
      {
        hasAssurance: false,
        id: 'line-1',
        item: { productId: cartItem().id },
        lineTotalMinor: 0,
        quantity,
        unitPriceMinor: 0,
      },
    ],
    merchantId: 'merchant-1',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version,
  },
  warnings: [],
});

it('reduces the matching live line by the removed row quantity', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue(snapshot(5) as never);
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: true,
  } as never);
  await expect(
    removeCapacityLineFromLiveCart(cartItem({ quantity: 2 }), 'shop')
  ).resolves.toBe(true);
  expect(sendSharedCartCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      command: { type: 'set_quantity', lineId: 'line-1', quantity: 3 },
      expectedVersion: 3,
    }),
    'shop'
  );
});

it('removes the live line when quantities match and retries a version conflict', async () => {
  vi.mocked(fetchSharedCartSnapshot)
    .mockResolvedValueOnce(snapshot(2) as never)
    .mockResolvedValueOnce(snapshot(2, 4) as never);
  vi.mocked(sendSharedCartCommand)
    .mockResolvedValueOnce({ ok: false, code: 'version_conflict' } as never)
    .mockResolvedValueOnce({ ok: true } as never);
  await expect(
    removeCapacityLineFromLiveCart(cartItem({ quantity: 2 }), 'shop')
  ).resolves.toBe(true);
  expect(sendSharedCartCommand).toHaveBeenLastCalledWith(
    expect.objectContaining({
      command: { type: 'remove', lineId: 'line-1' },
      expectedVersion: 4,
    }),
    'shop'
  );
});

it('targets the line matching the assurance lane among same-identity lines', async () => {
  const base = snapshot(4);
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ...base,
    snapshot: {
      ...base.snapshot,
      lines: [
        { ...base.snapshot.lines[0], id: 'line-plain', hasAssurance: false },
        {
          ...base.snapshot.lines[0],
          id: 'line-assured',
          hasAssurance: true,
          assuranceRate: 0.05,
        },
      ],
    },
  } as never);
  vi.mocked(sendSharedCartCommand).mockResolvedValue({ ok: true } as never);
  await expect(
    removeCapacityLineFromLiveCart(
      cartItem({ quantity: 1, hasAssurance: true, assuranceRate: 0.05 }),
      'shop'
    )
  ).resolves.toBe(true);
  expect(sendSharedCartCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      command: { type: 'set_quantity', lineId: 'line-assured', quantity: 3 },
    }),
    'shop'
  );
});
it('reports failure when the snapshot fetch fails retryably', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
    retryable: true,
  } as never);
  await expect(
    removeCapacityLineFromLiveCart(cartItem({ quantity: 2 }), 'shop')
  ).resolves.toBe(false);
});
it('treats a missing live cart as nothing to update', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: false,
    code: 'not_found',
    retryable: false,
  } as never);
  await expect(
    removeCapacityLineFromLiveCart(cartItem({ quantity: 2 }), 'shop')
  ).resolves.toBe(true);
});
it('reports failure when the live cart cannot be updated', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue(snapshot(2) as never);
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
  } as never);
  await expect(
    removeCapacityLineFromLiveCart(cartItem({ quantity: 2 }), 'shop')
  ).resolves.toBe(false);
});

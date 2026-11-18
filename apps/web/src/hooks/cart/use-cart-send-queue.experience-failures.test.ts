import type { CartSnapshot } from '@baci/shared/cart';
import { renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { isCartCookieEpochCurrent } from './cart-cross-tab-lock';
import { sendSharedCartCommand } from './shared-cart-client';
import { createSharedCartCommandPort } from './shared-cart-command-port';
import type { SharedCartExperienceEntry } from './shared-cart-experience-types';
import { useCartSendQueue } from './use-cart-send-queue';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

vi.mock('./shared-cart-client', () => ({
  sendSharedCartCommand: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
}));
vi.mock('./cart-cross-tab-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cart-cross-tab-lock')>()),
  isCartCookieEpochCurrent: vi.fn(() => true),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCartCookieEpochCurrent).mockReturnValue(true);
});
const snapshot: CartSnapshot = {
  cartId: 'cart',
  merchantId: 'm',
  state: 'active',
  version: 1,
  currency: 'NGN',
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2099-01-01',
  lines: [],
};
async function setup(
  provisioning: boolean,
  retryable = false,
  expireDuringPrepare = false
) {
  const entries = new Map<string, SharedCartExperienceEntry>();
  const port = createSharedCartCommandPort({
    enabled: () => true,
    generation: () => 1,
    read: () => snapshot,
    enqueue: vi.fn(),
    resolveProduct: async () => null,
    admit: () => ({ allowed: true }),
    loadContinuity: async () => 'shopper',
    entries,
    receiptStorage: null,
  });
  const pending = port.submit(
    { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
    'sdk'
  );
  await vi.waitFor(() => expect(entries.has('sdk')).toBe(true));
  const entry = entries.get('sdk');
  if (!entry) throw Error('Missing operation');
  const deny = vi.spyOn(entry, 'deny');
  if (expireDuringPrepare) {
    const prepare = entry.prepare.bind(entry);
    entry.prepare = async (value) => {
      const result = await prepare(value);
      vi.mocked(isCartCookieEpochCurrent).mockReturnValue(false);
      return result;
    };
  }
  const ensureCart = vi.fn(async () => ({
    ok: false as const,
    code: 'unauthorized' as const,
    retryable,
    snapshot: null,
  }));
  const dispatch = vi.fn();
  renderHook(() => {
    const runtime = useSharedCartRuntime({
      merchantId: 'm',
      merchantSlug: 'shop',
      sessionGeneration: 1,
    });
    const state = {
      ...runtime.state,
      generation: 1,
      merchantId: 'm',
      cartId: provisioning ? null : 'cart',
      confirmed: provisioning ? null : snapshot,
      queue: [
        {
          operationId: 'sdk',
          state: 'queued' as const,
          attempts: 0,
          intent: {
            kind: 'remove' as const,
            target: {
              kind: 'lineId' as const,
              lineId: '10000000-0000-4000-8000-000000000001',
            },
          },
        },
      ],
    };
    useEffect(() => {
      runtime.stateRef.current = state;
    });
    useCartSendQueue({
      ...runtime,
      state,
      dispatch,
      linkPhase: 'ready',
      ensureCart,
      experienceEntriesRef: { current: entries },
      finishImportOp: vi.fn(),
      hydrateMissing: vi.fn(),
    });
  });
  return { pending, deny, dispatch, ensureCart };
}
it('settles a non-retryable provisioning failure without sending an engine command', async () => {
  const f = await setup(true);
  await waitFor(() =>
    expect(f.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command/failed', retryable: false })
    )
  );
  expect(f.deny).toHaveBeenCalledOnce();
  await expect(f.pending).resolves.toMatchObject({
    status: 'error',
    code: 'CONNECTION_REVOKED',
  });
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
});
it('preserves retryable provisioning failures as pending work', async () => {
  const f = await setup(true, true);
  await waitFor(() =>
    expect(f.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command/failed', retryable: true })
    )
  );
  expect(f.deny).not.toHaveBeenCalled();
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
});
it('cancels and settles a prepared SDK operation if its cookie epoch expires before transport', async () => {
  const f = await setup(false, false, true);
  await waitFor(() =>
    expect(isCartCookieEpochCurrent).toHaveReturnedWith(false)
  );
  expect(f.deny).toHaveBeenCalledOnce();
  expect(f.dispatch).toHaveBeenCalledWith({
    type: 'command/cancel',
    generation: 1,
    operationId: 'sdk',
  });
  await expect(f.pending).resolves.toMatchObject({
    status: 'error',
    code: 'CONNECTION_REVOKED',
  });
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
});

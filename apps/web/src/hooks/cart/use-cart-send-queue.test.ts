import { sendSharedCartCommand } from './shared-cart-client';

vi.mock('./shared-cart-client', () => ({
  sendSharedCartCommand: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { expect, it, vi } from 'vitest';
import { useCartSendQueue } from './use-cart-send-queue';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

it('does not provision or send from a disabled cart client', () => {
  const ensureCart = vi.fn();
  const finishImportOp = vi.fn();
  const hydrateMissing = vi.fn();
  renderHook(() => {
    const runtime = useSharedCartRuntime({
      merchantId: 'm',
      merchantSlug: 'shop',
      sessionGeneration: 1,
      enabled: false,
    });
    useCartSendQueue({
      ...runtime,
      ensureCart,
      finishImportOp,
      hydrateMissing,
    });
  });
  expect(ensureCart).not.toHaveBeenCalled();
  expect(finishImportOp).not.toHaveBeenCalled();
  expect(hydrateMissing).not.toHaveBeenCalled();
});

it('pins a replacement to its original base version and stops instead of rebasing over a remote edit', async () => {
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: false,
    code: 'version_conflict',
    retryable: false,
    snapshot: null,
  });
  const dispatch = vi.fn();
  const finishImportOp = vi.fn();
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
      cartId: 'cart',
      confirmed: {
        cartId: 'cart',
        merchantId: 'm',
        state: 'active',
        version: 5,
        currency: 'NGN',
        subtotalMinor: 0,
        totalMinor: 0,
        estimatedTotals: false,
        expiresAt: '2099-01-01T00:00:00Z',
        lines: [],
      },
      queue: [
        {
          operationId: 'stable-replacement',
          state: 'queued',
          attempts: 0,
          silent: true,
          intent: { kind: 'replace', lines: [], expectedVersion: 4 },
        },
      ],
    } as typeof runtime.state;
    // Publish the fixture state after the runtime's own commit effect.
    useEffect(() => {
      runtime.stateRef.current = state;
    });
    useCartSendQueue({
      ...runtime,
      state,
      dispatch,
      linkPhase: 'ready',
      ensureCart: vi.fn(),
      finishImportOp,
      hydrateMissing: vi.fn(),
    });
  });
  await waitFor(() =>
    expect(finishImportOp).toHaveBeenCalledWith('stable-replacement', {
      ok: false,
      code: 'refresh_required',
    })
  );
  expect(sendSharedCartCommand).toHaveBeenCalledExactlyOnceWith(
    {
      command: { type: 'replace', lines: [] },
      expectedVersion: 4,
      operationId: 'stable-replacement',
    },
    'shop'
  );
  expect(dispatch).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'command/conflict' })
  );
});
it('retries an unknown replacement outcome with the exact original command, receipt and base version', async () => {
  vi.mocked(sendSharedCartCommand).mockReset();
  vi.mocked(sendSharedCartCommand)
    .mockResolvedValueOnce({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      snapshot: null,
    })
    .mockResolvedValueOnce({
      ok: true,
      replayed: true,
      snapshot: {
        cartId: 'cart',
        merchantId: 'm',
        version: 6,
        state: 'active',
        lines: [],
      },
      warnings: [],
    } as never);
  const dispatch = vi.fn();
  const finishImportOp = vi.fn();
  const { rerender } = renderHook(() => {
    const runtime = useSharedCartRuntime({
      merchantId: 'm',
      merchantSlug: 'shop',
      sessionGeneration: 1,
    });
    const state = {
      ...runtime.state,
      generation: 1,
      merchantId: 'm',
      cartId: 'cart',
      confirmed: {
        cartId: 'cart',
        merchantId: 'm',
        state: 'active',
        version: 5,
        currency: 'NGN',
        subtotalMinor: 0,
        totalMinor: 0,
        estimatedTotals: false,
        expiresAt: '2099-01-01T00:00:00Z',
        lines: [],
      },
      queue: [
        {
          operationId: 'stable-retry',
          state: 'queued',
          attempts: 0,
          silent: true,
          intent: { kind: 'replace', lines: [], expectedVersion: 4 },
        },
      ],
    } as typeof runtime.state;
    // Publish the fixture state after the runtime's own commit effect.
    useEffect(() => {
      runtime.stateRef.current = state;
    });
    useCartSendQueue({
      ...runtime,
      state,
      dispatch,
      linkPhase: 'ready',
      ensureCart: vi.fn(),
      finishImportOp,
      hydrateMissing: vi.fn(),
    });
  });
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command/failed', retryable: true })
    )
  );
  rerender();
  await waitFor(() =>
    expect(finishImportOp).toHaveBeenCalledWith('stable-retry', {
      ok: true,
      snapshot: expect.anything(),
    })
  );
  expect(vi.mocked(sendSharedCartCommand).mock.calls[0]).toEqual(
    vi.mocked(sendSharedCartCommand).mock.calls[1]
  );
});

it('does not send an SDK entry revoked while asynchronous preparation is paused', async () => {
  vi.mocked(sendSharedCartCommand).mockClear();
  let release: () => void = () => {};
  const preparing = new Promise<void>((r) => {
    release = r;
  });
  let allowed = true;
  const deny = vi.fn();
  const dispatch = vi.fn();
  renderHook(() => {
    const runtime = useSharedCartRuntime({
      merchantId: 'm',
      merchantSlug: 'shop',
      sessionGeneration: 1,
    });
    const snapshot = {
      cartId: 'cart',
      merchantId: 'm',
      state: 'active' as const,
      version: 1,
      currency: 'NGN',
      subtotalMinor: 0,
      totalMinor: 0,
      estimatedTotals: false,
      expiresAt: '2099-01-01',
      lines: [],
    };
    const state = {
      ...runtime.state,
      generation: 1,
      merchantId: 'm',
      cartId: 'cart',
      confirmed: snapshot,
      queue: [
        {
          operationId: 'sdk',
          state: 'queued' as const,
          attempts: 0,
          intent: { kind: 'clear' as const },
        },
      ],
    };
    useEffect(() => {
      runtime.stateRef.current = state;
      runtime.experienceEntriesRef.current.set('sdk', {
        signature: 'sdk',
        isSettled: () => false,
        canProject: () => true,
        generation: 1,

        prepare: async () => {
          await preparing;
          return true;
        },
        policy: {
          beforeAttempt: () =>
            allowed
              ? { allowed: true }
              : { allowed: false, code: 'STALE_ROUTE' },
          onAttemptStart: vi.fn(),
        },
        finish: vi.fn(),
        deny,
        promise: Promise.resolve({
          status: 'indeterminate',
          operationId: 'sdk',
        }),
      });
    });
    useCartSendQueue({
      ...runtime,
      state,
      dispatch,
      linkPhase: 'ready',
      ensureCart: vi.fn(),
      finishImportOp: vi.fn(),
      hydrateMissing: vi.fn(),
    });
  });
  allowed = false;
  release();
  await waitFor(() => expect(deny).toHaveBeenCalled());
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'command/cancel', operationId: 'sdk' })
  );
});

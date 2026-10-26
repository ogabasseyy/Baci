import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createCartRecovery } from './shared-cart-recovery';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

// The global setup installs a LockManager mock; these suites exercise
// the synchronous no-Web-Locks fallback path instead.
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
});

it('retries the original failed operation in the live generation', () => {
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  const runtime = result.current;
  const dispatch = vi.fn();
  runtime.stateRef.current = {
    ...runtime.stateRef.current,
    queue: [
      {
        operationId: 'original',
        state: 'failed',
        intent: { kind: 'clear' },
        attempts: 1,
      },
    ],
  };
  const refreshNow = vi.fn().mockResolvedValue(undefined);
  createCartRecovery({
    ...runtime,
    dispatch,
    refreshNow,
    ensureCart: vi.fn(),
  }).retryPendingSync();
  expect(dispatch).toHaveBeenCalledWith({
    generation: 7,
    operationId: 'original',
    type: 'command/retry',
  });
});

it('erases preserved lines when discarding after a terminal adoption', async () => {
  const { saveCartToStorage, getCartFromStorage } = await import(
    './cart-storage'
  );
  const { cartItem, snapshot } = await import(
    './shared-cart-provisioning.test-support'
  );
  saveCartToStorage([cartItem({ id: 'prod-9', cartItemId: 'prod-9' })], 'shop');
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  const runtime = result.current;
  runtime.stateRef.current = {
    ...runtime.stateRef.current,
    confirmed: snapshot({ state: 'completed', lines: [], version: 2 }),
    importStatus: 'failed',
    importWarnings: ['import_capacity_exceeded'],
  };
  createCartRecovery({
    ...runtime,
    dispatch: vi.fn(),
    setLinkPhase: vi.fn(),
    refreshNow: vi.fn(),
    ensureCart: vi.fn(),
  }).discardLegacyImport();
  expect(getCartFromStorage('shop')).toEqual([]);
});

it('discards a capacity-blocked device cart even when a create is retained', async () => {
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  const runtime = result.current;
  runtime.stateRef.current = {
    ...runtime.stateRef.current,
    importStatus: 'failed',
    importWarnings: ['import_capacity_exceeded'],
  };
  runtime.createAttemptedRef.current = true;
  runtime.createRequestRef.current = {
    lines: [{ item: { productId: 'prod-1' }, quantity: 1 }],
    operationId: 'import:create:deadbeef',
  } as never;
  const dispatch = vi.fn();
  const setLinkPhase = vi.fn();
  createCartRecovery({
    ...runtime,
    dispatch,
    setLinkPhase,
    refreshNow: vi.fn(),
    ensureCart: vi.fn(),
  }).discardLegacyImport();
  await vi.waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith({
      generation: 7,
      status: 'skipped',
      type: 'import/resolved',
    })
  );
  expect(runtime.createAttemptedRef.current).toBe(false);
  expect(runtime.createRequestRef.current).toBeNull();
  expect(setLinkPhase).toHaveBeenCalledWith('ready');
});

it('resolves an empty retry instead of leaving an untracked pending import', () => {
  window.localStorage.clear();
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  const runtime = result.current;
  runtime.stateRef.current = {
    ...runtime.stateRef.current,
    importStatus: 'failed',
  };
  const dispatch = vi.fn();
  createCartRecovery({
    ...runtime,
    dispatch,
    refreshNow: vi.fn(),
    ensureCart: vi.fn(),
  }).retryImport();
  expect(dispatch).toHaveBeenCalledWith({
    generation: 7,
    status: 'skipped',
    type: 'import/resolved',
  });
});

it('restores the retained create request when discard erasure fails', async () => {
  const { saveCartToStorage, cartItem } = await import(
    './shared-cart-provisioning.test-support'
  ).then(async (support) => ({
    cartItem: support.cartItem,
    saveCartToStorage: (await import('./cart-storage')).saveCartToStorage,
  }));
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  const runtime = result.current;
  runtime.stateRef.current = {
    ...runtime.stateRef.current,
    importStatus: 'failed',
    importWarnings: ['import_capacity_exceeded'],
  };
  runtime.createAttemptedRef.current = true;
  const retained = {
    lines: [{ item: { productId: 'prod-1' }, quantity: 1 }],
    operationId: 'import:create:deadbeef',
  };
  runtime.createRequestRef.current = retained as never;
  const dispatch = vi.fn();
  createCartRecovery({
    ...runtime,
    dispatch,
    setLinkPhase: vi.fn(),
    refreshNow: vi.fn(),
    ensureCart: vi.fn(),
  }).discardLegacyImport();
  // Simulate the erasure not persisting: the parked cache is still
  // there when the discard write verifies it.
  saveCartToStorage([cartItem({ id: 'prod-1', cartItemId: 'prod-1' })], 'shop');
  await vi.waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'import/failed' })
    )
  );
  // The exact retained create survives for replay-safe retry.
  expect(runtime.createAttemptedRef.current).toBe(true);
  expect(runtime.createRequestRef.current).toBe(retained);
});

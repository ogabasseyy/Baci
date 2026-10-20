import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { saveCartToStorage } from './cart-storage';
import { adoptPreservedCart } from './shared-cart-preserved-session';
import { cartItem, snapshot } from './shared-cart-provisioning.test-support';
import { createCartRecovery } from './shared-cart-recovery';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

it('adopts a preserved live cart and queues the saved items against its identity', () => {
  window.localStorage.clear();
  saveCartToStorage([cartItem()], 'shop');
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  const dispatch = vi.fn();
  const runtime = { ...result.current, dispatch };
  adoptPreservedCart(runtime, snapshot({ lines: [] }));
  expect(runtime.adoptOutcomeRef.current).toBe('session');
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'link/snapshot',
      snapshot: snapshot({ lines: [] }),
    })
  );
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'import/enqueue',
      entries: expect.any(Array),
    })
  );
});
it('retries a failed import even after fallback created an empty server cart', () => {
  window.localStorage.clear();
  saveCartToStorage([cartItem()], 'shop');
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  const dispatch = vi.fn();
  result.current.stateRef.current = {
    ...result.current.stateRef.current,
    confirmed: snapshot({ lines: [] }),
    importStatus: 'failed',
  };
  createCartRecovery({
    ...result.current,
    dispatch,
    ensureCart: vi.fn(),
    refreshNow: vi.fn(),
  }).retryPendingSync();
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'import/enqueue' })
  );
});
it('surfaces temporary busy recovery rather than silently ignoring a retry', () => {
  saveCartToStorage([cartItem()], 'shop');
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: 'merchant',
      merchantSlug: 'shop',
      sessionGeneration: 7,
    })
  );
  result.current.stateRef.current = {
    ...result.current.stateRef.current,
    importStatus: 'failed',
  };
  result.current.bootstrappingRef.current = true;
  const dispatch = vi.fn();
  createCartRecovery({
    ...result.current,
    dispatch,
    ensureCart: vi.fn(),
    refreshNow: vi.fn(),
  }).retryImport();
  expect(dispatch).toHaveBeenCalledWith({
    generation: 7,
    type: 'import/failed',
    code: 'temporarily_unavailable',
  });
});

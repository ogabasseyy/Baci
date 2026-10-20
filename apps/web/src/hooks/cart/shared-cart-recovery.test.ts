import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createCartRecovery } from './shared-cart-recovery';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

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

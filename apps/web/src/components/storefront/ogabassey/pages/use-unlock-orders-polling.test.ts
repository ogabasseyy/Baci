import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock('./imei-remediation-api', () => ({
  imeiRemediationApi: { list: mocks.list },
}));

import {
  MAX_UNLOCK_ORDERS_POLL_ATTEMPTS,
  UNLOCK_ORDERS_POLL_INTERVAL_MS,
  useUnlockOrdersPolling,
} from './use-unlock-orders-polling';

describe('useUnlockOrdersPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.list.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses after exhausting the poll budget and restarts on restartPolling()', async () => {
    const { result } = renderHook(() => useUnlockOrdersPolling('ogabassey'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(result.current.pollingPaused).toBe(false);

    for (let i = 1; i < MAX_UNLOCK_ORDERS_POLL_ATTEMPTS; i++) {
      await act(async () => {
        vi.advanceTimersByTime(UNLOCK_ORDERS_POLL_INTERVAL_MS);
        await Promise.resolve();
      });
    }

    expect(mocks.list).toHaveBeenCalledTimes(MAX_UNLOCK_ORDERS_POLL_ATTEMPTS);
    expect(result.current.pollingPaused).toBe(true);

    await act(async () => {
      result.current.restartPolling();
      await Promise.resolve();
    });

    expect(result.current.pollingPaused).toBe(false);
    expect(mocks.list).toHaveBeenCalledTimes(
      MAX_UNLOCK_ORDERS_POLL_ATTEMPTS + 1
    );
  });

  it('aborts in-flight requests on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.list.mockImplementation((_slug: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => undefined);
    });

    const { unmount } = renderHook(() => useUnlockOrdersPolling('ogabassey'));
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

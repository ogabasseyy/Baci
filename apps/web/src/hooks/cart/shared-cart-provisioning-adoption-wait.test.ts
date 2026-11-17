import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  MERCHANT_ID,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

type SnapshotResult = Awaited<ReturnType<typeof fetchSharedCartSnapshot>>;

function renderCart() {
  return renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
}

describe('useSharedCart host request during initial adoption', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    } as never);
  });

  it('waits for the pending initial read and then accepts a valid session', async () => {
    let finishRead: (value: SnapshotResult) => void = () => undefined;
    vi.mocked(fetchSharedCartSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    const { result } = renderCart();
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );

    let request:
      | ReturnType<typeof result.current.ensureCartSession>
      | undefined;
    act(() => {
      request = result.current.ensureCartSession();
    });
    await act(async () => {
      finishRead({
        ok: true,
        snapshot: snapshot(),
        warnings: [],
      } as SnapshotResult);
    });

    await expect(request).resolves.toEqual({ ok: true });
    expect(createSharedCart).not.toHaveBeenCalled();
    expect(bootstrapSharedCart).not.toHaveBeenCalled();
  });

  it('keeps the retryable failure when adoption never settles in time', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockImplementation(
      () => new Promise(() => undefined)
    );
    const { result } = renderCart();
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );
    vi.useFakeTimers();

    let request:
      | ReturnType<typeof result.current.ensureCartSession>
      | undefined;
    act(() => {
      request = result.current.ensureCartSession();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });

    await expect(request).resolves.toEqual({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    });
  });
});

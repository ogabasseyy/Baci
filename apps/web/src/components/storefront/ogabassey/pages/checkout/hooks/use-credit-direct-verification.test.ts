import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreditDirectVerification } from './use-credit-direct-verification';

const fetchMock = vi.fn();

function orderResponse(
  paymentStatus: string | null,
  inventoryConfirmed = false
) {
  return {
    ok: true,
    json: async () => ({
      payment_status: paymentStatus,
      inventory_confirmed: inventoryConfirmed,
    }),
  };
}

const baseOptions = {
  active: true,
  orderId: 'order-1',
  merchantSlug: 'test-store',
  trackingToken: 'tok-123',
  lookupEmail: null,
  pollIntervalMs: 10,
  timeoutMs: 45,
};

describe('useCreditDirectVerification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stays idle while inactive', () => {
    const { result } = renderHook(() =>
      useCreditDirectVerification({ ...baseOptions, active: false }),
    );

    expect(result.current.phase).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls the order endpoint with the tracking token and email lookup', async () => {
    fetchMock.mockResolvedValue(orderResponse('bnpl_pending'));

    renderHook(() =>
      useCreditDirectVerification({
        ...baseOptions,
        lookupEmail: 'customer@example.com',
      }),
    );
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/order-1?merchant_slug=test-store&token=tok-123&email=customer%40example.com',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('confirms once the payment status flips to bnpl_approved with inventory proof', async () => {
    fetchMock
      .mockResolvedValueOnce(orderResponse('bnpl_pending'))
      .mockResolvedValueOnce(orderResponse('bnpl_approved', true));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});
    expect(result.current.phase).toBe('polling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.phase).toBe('confirmed');
  });

  it('confirms when the payment status is already paid with inventory proof', async () => {
    fetchMock.mockResolvedValue(orderResponse('paid', true));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});

    expect(result.current.phase).toBe('confirmed');
  });

  it('keeps polling while approved without inventory proof', async () => {
    // The webhook writes approval before inventory confirmation lands
    // (and rolls it back on failure): approval without the server
    // proof must never confirm, no matter how many reads observe it.
    fetchMock.mockResolvedValue(orderResponse('bnpl_approved', false));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });

    expect(result.current.phase).toBe('polling');
  });

  it('keeps polling when approval rolls back after consecutive approved reads', async () => {
    // Slow inventory spanning poll intervals: two approved reads
    // arrive before the webhook fails and rolls the order back to
    // pending. None of the approved reads carries proof, so the
    // hook never confirms.
    fetchMock
      .mockResolvedValueOnce(orderResponse('bnpl_approved', false))
      .mockResolvedValueOnce(orderResponse('bnpl_approved', false))
      .mockResolvedValue(orderResponse('pending', false));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(result.current.phase).toBe('polling');
  });

  it('confirms once the proof lands after unproven approved reads', async () => {
    fetchMock
      .mockResolvedValueOnce(orderResponse('bnpl_approved', false))
      .mockResolvedValue(orderResponse('bnpl_approved', true));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});
    expect(result.current.phase).toBe('polling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.phase).toBe('confirmed');
  });

  it('reports cancellation when the order was cancelled', async () => {
    fetchMock.mockResolvedValue(orderResponse('cancelled'));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});

    expect(result.current.phase).toBe('cancelled');
  });

  it('keeps polling through transient fetch failures', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(orderResponse('bnpl_approved', true));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});
    expect(result.current.phase).toBe('polling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.phase).toBe('confirmed');
  });

  it('reaches the timeout even when a poll request hangs indefinitely', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        }),
    );

    const { result } = renderHook(() =>
      useCreditDirectVerification({ ...baseOptions, requestTimeoutMs: 20 }),
    );
    await act(async () => {});
    expect(result.current.phase).toBe('polling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(70);
    });

    expect(result.current.phase).toBe('timeout');
  });

  it('times out after the deadline when the status never resolves', async () => {
    fetchMock.mockResolvedValue(orderResponse('bnpl_pending'));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.phase).toBe('timeout');
  });

  it('restart resumes polling after a timeout', async () => {
    fetchMock.mockResolvedValue(orderResponse('bnpl_pending'));

    const { result } = renderHook(() =>
      useCreditDirectVerification(baseOptions),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(result.current.phase).toBe('timeout');

    fetchMock.mockResolvedValue(orderResponse('bnpl_approved', true));
    await act(async () => {
      result.current.restart();
    });
    await act(async () => {});

    expect(result.current.phase).toBe('confirmed');
  });
});

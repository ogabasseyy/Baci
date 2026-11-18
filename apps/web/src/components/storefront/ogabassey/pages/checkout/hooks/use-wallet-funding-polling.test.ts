import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getIntentMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/order-wallet-funding-intent-client', () => ({
  getOrderWalletFundingIntent: getIntentMock,
}));

import { useWalletFundingPolling } from './use-wallet-funding-polling';

const BASE_INTENT = {
  currency: 'NGN',
  expectedAmount: 5000,
  expiresAt: '2026-07-13T10:30:00.000Z',
  fundedAmount: 0,
  id: 'intent-1',
  orderId: 'order-1',
  status: 'pending' as const,
  targetOrderAmount: 5000,
};

function renderPolling(
  overrides: Partial<Parameters<typeof useWalletFundingPolling>[0]> = {}
) {
  const onCompleted = vi.fn();
  const view = renderHook(() =>
    useWalletFundingPolling({
      enabled: true,
      intentId: 'intent-1',
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      onCompleted,
      pollIntervalMs: 1000,
      ...overrides,
    })
  );
  return { onCompleted, view };
}

describe('useWalletFundingPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not poll when disabled', () => {
    // Deterministic: fake timers prove no interval fires without depending on
    // the real scheduler (repo forbids real timers in tests).
    vi.useFakeTimers();
    try {
      getIntentMock.mockResolvedValue(BASE_INTENT);

      renderPolling({ enabled: false });

      vi.advanceTimersByTime(10_000);
      expect(getIntentMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes the polled intent and fires onCompleted once when the order is paid', async () => {
    getIntentMock.mockResolvedValue({
      ...BASE_INTENT,
      fundedAmount: 5000,
      orderPaid: true,
      status: 'completed',
    });

    const { onCompleted, view } = renderPolling();

    await waitFor(() => {
      expect(view.result.current.intent?.status).toBe('completed');
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);

    // Terminal ⇒ the interval is torn down, so a manual check is a no-op.
    await act(async () => {
      view.result.current.checkNow();
    });
    expect(getIntentMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the partial transfer polling instead of stopping', async () => {
    getIntentMock.mockResolvedValue({
      ...BASE_INTENT,
      fundedAmount: 2000,
      remainingAmount: 3000,
      status: 'underfunded',
    });

    const { onCompleted, view } = renderPolling();

    await waitFor(() => {
      expect(view.result.current.intent?.status).toBe('underfunded');
    });
    expect(onCompleted).not.toHaveBeenCalled();

    await act(async () => {
      view.result.current.checkNow();
    });
    expect(getIntentMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('never reports an ambiguous transfer as completed', async () => {
    getIntentMock.mockResolvedValue({
      ...BASE_INTENT,
      status: 'review_required',
    });

    const { onCompleted, view } = renderPolling();

    await waitFor(() => {
      expect(view.result.current.intent?.status).toBe('review_required');
    });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  // Regression (cross-intent completion): a manual "check now" for transfer A
  // that resolves late must NOT fire onCompleted once the customer has closed A
  // and opened transfer B — otherwise checkout would clear the cart and redirect
  // to B's success page while B is still unpaid.
  it('drops a late manual check once the customer switches to another transfer', async () => {
    getIntentMock.mockResolvedValue({ ...BASE_INTENT, status: 'pending' });

    const onCompleted = vi.fn();
    const { rerender, result } = renderHook(
      ({ intentId }) =>
        useWalletFundingPolling({
          enabled: true,
          intentId,
          merchantId: 'merchant-1',
          merchantSlug: 'test-store',
          onCompleted,
          // Effectively disable the interval so only the manual check is racing.
          pollIntervalMs: 10_000_000,
        }),
      { initialProps: { intentId: 'intent-a' } }
    );

    // Let the initial auto-poll settle so the manual check is not blocked.
    await waitFor(() => {
      expect(result.current.intent?.status).toBe('pending');
    });

    // The manual check for A is issued but its response is held in flight.
    let resolveManual: (intent: unknown) => void = () => {};
    getIntentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveManual = resolve;
        })
    );
    act(() => {
      result.current.checkNow();
    });

    // Customer closes A and starts transfer B before A's check resolves.
    rerender({ intentId: 'intent-b' });

    // A's manual check now returns `completed` — but it belongs to the old intent.
    await act(async () => {
      resolveManual({
        ...BASE_INTENT,
        fundedAmount: 5000,
        id: 'intent-a',
        orderPaid: true,
        status: 'completed',
      });
    });

    expect(onCompleted).not.toHaveBeenCalled();
  });

  // Regression (cross-intent completion, scheduled path): a scheduled interval
  // poll for transfer A that resolves after the customer closes A and opens
  // transfer B must NOT settle B. The scheduled poll is bound to its
  // originating intent exactly like the manual "check now" guard, so a stale
  // transfer-A `completed` can never clear the cart or mark B as paid.
  it('drops a late scheduled poll once the customer switches to another transfer', async () => {
    const onCompleted = vi.fn();

    // Hold transfer A's scheduled (auto) poll in flight.
    let resolveScheduledA: (intent: unknown) => void = () => {};
    getIntentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveScheduledA = resolve;
        })
    );
    // Transfer B's scheduled poll stays non-terminal so `completedRef` never
    // trips — this isolates the intent-identity guard from the "fire once"
    // guard, proving A is dropped on its own merits.
    getIntentMock.mockResolvedValue({
      ...BASE_INTENT,
      id: 'intent-b',
      status: 'pending',
    });

    const { rerender, result } = renderHook(
      ({ intentId }) =>
        useWalletFundingPolling({
          enabled: true,
          intentId,
          merchantId: 'merchant-1',
          merchantSlug: 'test-store',
          onCompleted,
          // Large interval: only the initial scheduled poll is racing.
          pollIntervalMs: 10_000_000,
        }),
      { initialProps: { intentId: 'intent-a' } }
    );

    // Customer closes A and starts transfer B while A's poll is still in flight.
    rerender({ intentId: 'intent-b' });

    await waitFor(() => {
      expect(result.current.intent?.status).toBe('pending');
    });

    // A's scheduled poll now returns `completed` — but it belongs to the old
    // intent and must be ignored.
    await act(async () => {
      resolveScheduledA({
        ...BASE_INTENT,
        fundedAmount: 5000,
        id: 'intent-a',
        orderPaid: true,
        status: 'completed',
      });
    });

    expect(onCompleted).not.toHaveBeenCalled();
    // The active transfer B is untouched by the stale A response.
    expect(result.current.intent?.status).toBe('pending');
  });

  it('surfaces a poll failure as an error without claiming payment', async () => {
    getIntentMock.mockRejectedValue(new Error('offline'));

    const { onCompleted, view } = renderPolling();

    await waitFor(() => {
      expect(view.result.current.error).toBe('offline');
    });
    expect(view.result.current.intent).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('pauses polling while hidden and stops after maxAttempts', async () => {
    vi.useFakeTimers();
    getIntentMock.mockResolvedValue(BASE_INTENT);

    let visibility: DocumentVisibilityState = 'hidden';
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState'
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    try {
      renderHook(() =>
        useWalletFundingPolling({
          enabled: true,
          intentId: 'intent-1',
          merchantId: 'merchant-1',
          merchantSlug: 'test-store',
          onCompleted: vi.fn(),
          pollIntervalMs: 1000,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(getIntentMock).not.toHaveBeenCalled();

      visibility = 'visible';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(100_000);
      });
      expect(getIntentMock).toHaveBeenCalledTimes(60);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, 'visibilityState', originalDescriptor);
      }
      vi.useRealTimers();
    }
  });
});

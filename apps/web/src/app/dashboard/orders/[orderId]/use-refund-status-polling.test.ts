import { act, render, screen } from '@testing-library/react';
import React, { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { useRefundStatusPolling } from './use-refund-status-polling';

const summary = {
  currency: 'NGN',
  amountPaid: 100,
  refunded: 0,
  remaining: 100,
  pending: 0,
  status: 'failed',
  error: null,
  attempts: 1,
  retryRequests: 0,
  canRetry: false,
  canRecordManual: false,
  canManageRefunds: true,
  history: [],
} as unknown as RefundSummary;

function Harness({
  hasInitialSummary = false,
  settledWatch = false,
  terminal,
}: {
  hasInitialSummary?: boolean;
  settledWatch?: boolean;
  terminal: boolean;
}) {
  const [current, setCurrent] = useState<RefundSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  useRefundStatusPolling({
    hasInitialSummary,
    onError: setError,
    onSummary: setCurrent,
    orderId: 'order-1',
    revision,
    settledWatch,
    terminal,
  });
  return React.createElement(
    'p',
    null,
    error ?? (current ? `status:${current.status}` : 'loading')
  );
}

describe('useRefundStatusPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => summary })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('loads on mount and re-polls while non-terminal', async () => {
    render(React.createElement(Harness, { terminal: false }));
    await act(async () => {});
    expect(screen.getByText('status:failed')).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
  it('stops polling once the refund is terminal', async () => {
    const { rerender } = render(
      React.createElement(Harness, { terminal: false })
    );
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    rerender(React.createElement(Harness, { terminal: true }));
    await act(async () => {});
    // The flip itself refetches nothing, or the fresh submit
    // response would be clobbered by a stale read.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it('skips the mount fetch with a server summary but still polls', async () => {
    render(
      React.createElement(Harness, {
        hasInitialSummary: true,
        terminal: false,
      })
    );
    await act(async () => {});
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it('drops a stale poll response that lands after a newer one', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(fetch)
      .mockReturnValueOnce(first as unknown as Promise<Response>)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ ...summary, status: 'processing' }),
      } as unknown as Response);
    render(React.createElement(Harness, { terminal: false }));
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {});
    expect(screen.getByText('status:processing')).toBeInTheDocument();
    // The slow first poll lands last: without the request sequence
    // it would clobber the panel with its stale summary.
    await act(async () => {
      resolveFirst({ ok: true, json: async () => summary });
    });
    await act(async () => {});
    expect(screen.getByText('status:processing')).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('surfaces load errors without polling past them', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unable to load refund' }),
    } as unknown as Response);
    render(React.createElement(Harness, { terminal: true }));
    await act(async () => {});
    expect(screen.getByText('Unable to load refund')).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('watches settled orders slowly, then stops and relies on tab return', async () => {
    render(
      React.createElement(Harness, {
        settledWatch: true,
        terminal: false,
      })
    );
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    // The 30s cadence does not apply: four minutes stay quiet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    // The first slow poll lands at five minutes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    // Eleven more slow polls exhaust the hour-long watch; the
    // thirteenth tick stops the timer instead of billing the RPC.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 300_000);
    });
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(13);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(13);
    // Returning to the tab still refreshes after the watch ends.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(14);
  });
  it('pauses while the tab is hidden and refreshes on return', async () => {
    render(React.createElement(Harness, { terminal: false }));
    await act(async () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      await act(async () => {});
      // Three ticks while hidden: no background RPC traffic.
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {});
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
    }
  });
});

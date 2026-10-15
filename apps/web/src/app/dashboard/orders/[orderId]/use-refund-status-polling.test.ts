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

function Harness({ terminal }: { terminal: boolean }) {
  const [current, setCurrent] = useState<RefundSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  useRefundStatusPolling({
    onError: setError,
    onSummary: setCurrent,
    orderId: 'order-1',
    revision,
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
});

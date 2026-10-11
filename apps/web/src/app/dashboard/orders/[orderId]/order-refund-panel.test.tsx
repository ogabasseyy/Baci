import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '@/lib/api-client';
import { OrderRefundPanel } from './order-refund-panel';

const summary = {
  currency: 'NGN',
  amountPaid: 27574.83,
  refunded: 0,
  remaining: 27574.83,
  pending: 0,
  status: 'failed',
  error: 'Insufficient balance to process refund',
  attempts: 5,
  retryRequests: 0,
  canRetry: true,
  canRecordManual: true,
  canManageRefunds: true,
  history: [],
};
describe('OrderRefundPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => summary })
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('shows the failed refund and queues a retry', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      ...summary,
      status: 'queued',
      canRetry: false,
      error: null,
    });
    render(<OrderRefundPanel orderId="order-1" />);
    const button = await screen.findByRole('button', { name: 'Retry refund' });
    // Worker errors render a fixed label; the raw string stays out
    // of the DOM entirely, like the route's error masking.
    const label = screen.getByText(
      'The refund ran into a problem. Support has the details.'
    );
    expect(label).toBeInTheDocument();
    expect(label).not.toHaveAttribute('title');
    expect(
      screen.queryByText('Insufficient balance to process refund')
    ).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/orders/order-1/refund', {
        action: 'retry',
      })
    );
    expect(await screen.findByText('Queued')).toBeInTheDocument();
  });
  it('shows load errors without enabling refund actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Forbidden' }),
      })
    );
    render(<OrderRefundPanel orderId="order-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(
      screen.queryByRole('button', { name: 'Retry refund' })
    ).not.toBeInTheDocument();
  });
  it('explains a busy step instead of claiming missing permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...summary,
          canManageRefunds: false,
          status: 'processing',
        }),
      })
    );
    render(<OrderRefundPanel orderId="order-1" />);
    expect(
      await screen.findByText(
        'Refund is being processed. Retry and manual recording unlock when it settles.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'You need refund permission to retry or record refunds.'
      )
    ).not.toBeInTheDocument();
  });
  it('hides refund actions when the caller lacks refund permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...summary, canManageRefunds: false }),
      })
    );
    render(<OrderRefundPanel orderId="order-1" />);
    expect(
      await screen.findByText(
        'You need refund permission to retry or record refunds.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry refund' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Record manual refund' })
    ).not.toBeInTheDocument();
  });
  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      })
    );
    render(<OrderRefundPanel orderId="order-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load refund'
    );
  });
  it('encodes the order id in refund requests', async () => {
    render(<OrderRefundPanel orderId="order/1?x" />);
    await screen.findByRole('button', { name: 'Retry refund' });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/orders/order%2F1%3Fx/refund',
      expect.objectContaining({ credentials: 'include' })
    );
  });
  it('fires the refunded callback once per order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...summary, status: 'refunded' }),
      })
    );
    const first = vi.fn();
    const { rerender } = render(
      <OrderRefundPanel orderId="order-1" onRefunded={first} />
    );
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    // A parent re-render with a fresh inline closure must not refire.
    rerender(<OrderRefundPanel orderId="order-1" onRefunded={() => {}} />);
    rerender(<OrderRefundPanel orderId="order-1" onRefunded={() => {}} />);
    expect(first).toHaveBeenCalledTimes(1);
    // One mounted panel viewing successive orders notifies once per order.
    const second = vi.fn();
    rerender(<OrderRefundPanel orderId="order-2" onRefunded={second} />);
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  });
  it('masks raw worker text in the refund activity list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...summary,
          error: null,
          events: [
            {
              id: 'event-1',
              action: 'retry_requested',
              date: '2026-10-01T12:00:00Z',
              actor: null,
              details: { error: 'Paystack/insufficient-balance (acquirer 51)' },
            },
          ],
        }),
      })
    );
    render(<OrderRefundPanel orderId="order-1" />);
    const label = await screen.findByText(
      'The refund ran into a problem. Support has the details.'
    );
    expect(label).not.toHaveAttribute('title');
    expect(
      screen.queryByText('Paystack/insufficient-balance (acquirer 51)')
    ).not.toBeInTheDocument();
  });
  it('stops polling once the refund reaches a terminal state', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ ...summary, status: 'refunded' }),
        })
      );
      render(<OrderRefundPanel orderId="order-1" />);
      await vi.waitFor(() =>
        expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0)
      );
      // Mount and terminal-transition loads settle, then quiet: a
      // full minute must add no further status polls.
      const settled = vi.mocked(fetch).mock.calls.length;
      await vi.advanceTimersByTimeAsync(61_000);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(settled);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps polling while the refund can still change', async () => {
    vi.useFakeTimers();
    try {
      render(<OrderRefundPanel orderId="order-1" />);
      await vi.waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Retry refund' })
        ).toBeInTheDocument()
      );
      const settled = vi.mocked(fetch).mock.calls.length;
      await vi.advanceTimersByTimeAsync(61_000);
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(settled);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps polling a failed refund with no actions left', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            ...summary,
            canRecordManual: false,
            canRetry: false,
            status: 'failed',
          }),
        })
      );
      render(<OrderRefundPanel orderId="order-1" />);
      await vi.waitFor(() =>
        expect(screen.getAllByText('Failed').length).toBeGreaterThan(0)
      );
      // The drain or provider reconciliation can still transition
      // the row, so the poll must continue past action exhaustion.
      const settled = vi.mocked(fetch).mock.calls.length;
      await vi.advanceTimersByTimeAsync(61_000);
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(settled);
    } finally {
      vi.useRealTimers();
    }
  });
});

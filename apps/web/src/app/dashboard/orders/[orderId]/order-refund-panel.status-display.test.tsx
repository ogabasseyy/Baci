import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({ apiPost: vi.fn() }));

import { OrderRefundPanel } from './order-refund-panel';

const summary = {
  currency: 'NGN',
  amountPaid: 27574.83,
  refunded: 0,
  remaining: 27574.83,
  pending: 0,
  status: 'failed',
  error: null,
  attempts: 5,
  retryRequests: 0,
  canRetry: true,
  canRecordManual: true,
  canManageRefunds: true,
  history: [],
};
describe('OrderRefundPanel status display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function loadWith(payload: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
    );
    render(<OrderRefundPanel orderId="order-1" />);
  }
  it('maps history status and method identifiers to labels', async () => {
    loadWith({
      ...summary,
      history: [
        {
          id: 'h-1',
          amount: 100,
          status: 'refund_pending',
          method: 'bank_transfer',
          reference: 'bank-1',
          date: '2026-09-28T12:00:00Z',
        },
      ],
    });
    expect(await screen.findByText(/Refund pending/)).toBeInTheDocument();
    expect(screen.getByText(/Bank transfer/)).toBeInTheDocument();
    expect(screen.queryByText(/refund_pending/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bank_transfer/)).not.toBeInTheDocument();
  });
  it('keeps the Paystack guidance for Paystack-sourced reviews', async () => {
    loadWith({
      ...summary,
      status: 'requires_review',
      error: 'The refund ran into a problem. Support has the details.',
      needsPaystackCheck: true,
    });
    expect(
      await screen.findByText(
        'Verify the existing refund in Paystack before taking further action.'
      )
    ).toBeInTheDocument();
  });
  it('falls back to the raw status when no label exists', async () => {
    loadWith({ ...summary, status: 'awaiting_settlement' });
    expect(await screen.findByText('awaiting_settlement')).toBeInTheDocument();
  });
  it('generalizes the guidance for non-Paystack reviews', async () => {
    loadWith({
      ...summary,
      status: 'requires_review',
      error: 'This refund needs review before it can continue.',
      needsPaystackCheck: false,
    });
    expect(
      await screen.findByText(
        'Review the flagged refund details before taking further action.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/in Paystack before taking/)
    ).not.toBeInTheDocument();
  });
  it('renders both error and previous error when they differ', async () => {
    loadWith({
      ...summary,
      events: [
        {
          id: 'e-1',
          action: 'failed',
          date: '2026-09-28T12:00:00Z',
          details: {
            error: 'The refund ran into a problem. Support has the details.',
            previousError: 'Refund in progress — waiting for the money.',
          },
        },
      ],
    });
    expect(
      await screen.findByText(
        'The refund ran into a problem. Support has the details.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Previously: Refund in progress — waiting for the money.'
      )
    ).toBeInTheDocument();
  });
  it('renders a fallback for malformed activity dates', async () => {
    loadWith({
      ...summary,
      events: [
        {
          id: 'e-1',
          action: 'failed',
          date: 'not-a-date',
          details: {},
        },
      ],
    });
    expect(await screen.findByText(/Date unavailable/)).toBeInTheDocument();
  });
  it('keeps polling a Paystack-backed refund past refunded', async () => {
    // A later contradictory provider verdict can re-open the
    // balance after completion, so provider-backed pages never
    // treat refunded as terminal. RPC-true shape: at full refund
    // the outstanding-leg list is empty and only the durable flag
    // carries the provider-backed signal.
    vi.useFakeTimers();
    try {
      loadWith({
        ...summary,
        status: 'refunded',
        legs: [],
        hasPaystackPayment: true,
      });
      await act(async () => {});
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops polling a refunded order without a Paystack payment', async () => {
    vi.useFakeTimers();
    try {
      loadWith({
        ...summary,
        status: 'refunded',
        legs: [],
        hasPaystackPayment: false,
      });
      await act(async () => {});
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps polling while the refund needs review', async () => {
    // Requires-review is not terminal: provider reconciliation can
    // still complete the underlying delivery_uncertain step, so an
    // open page must keep refreshing until it observes refunded.
    vi.useFakeTimers();
    try {
      loadWith({ ...summary, status: 'requires_review' });
      await act(async () => {});
      expect(screen.getByText('Refund')).toBeInTheDocument();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });
  it('paints first content from the server summary without a loading flash', async () => {
    // The page passes its server-fetched summary down: first paint
    // shows the status synchronously, and the mount fetch becomes a
    // background refresh instead of a blocking loader.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => summary })
    );
    render(
      <OrderRefundPanel
        orderId="order-1"
        initialSummary={{ ...summary, status: 'failed' } as never}
      />
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Loading refund…')).not.toBeInTheDocument();
    await act(async () => {});
  });
});

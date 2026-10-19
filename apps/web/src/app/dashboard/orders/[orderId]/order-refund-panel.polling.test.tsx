import { render, screen } from '@testing-library/react';
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
  error: 'The refund ran into a problem. Support has the details.',
  attempts: 5,
  retryRequests: 0,
  canRetry: true,
  canRecordManual: true,
  canManageRefunds: true,
  history: [],
};
describe('OrderRefundPanel polling', () => {
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
  it('watches a refunded Paystack-backed order slowly, then stops', async () => {
    // The durable flag (not legs, which empty exactly at full
    // refund) carries the provider-backed signal: a later
    // contradictory provider verdict can still re-open the
    // balance, including behind self-terminalized legs — but the
    // server sweep owns long-term detection, so the page watches
    // slowly for an hour instead of polling every 30s forever.
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            ...summary,
            hasPaystackPayment: true,
            status: 'refunded',
          }),
        })
      );
      render(<OrderRefundPanel orderId="order-1" />);
      await vi.waitFor(() =>
        expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0)
      );
      const settled = vi.mocked(fetch).mock.calls.length;
      // No 30s poll: the slow watch fires at five minutes.
      await vi.advanceTimersByTimeAsync(61_000);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(settled);
      await vi.advanceTimersByTimeAsync(240_000);
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(settled);
      // The hour-long watch exhausts, then the page goes quiet.
      await vi.advanceTimersByTimeAsync(12 * 300_000);
      const watched = vi.mocked(fetch).mock.calls.length;
      await vi.advanceTimersByTimeAsync(600_000);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(watched);
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

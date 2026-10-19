import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
describe('OrderRefundPanel form revocation', () => {
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
  it('closes the manual form when polling revokes the manual flag', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => summary,
          })
          .mockResolvedValue({
            ok: true,
            json: async () => ({ ...summary, canRecordManual: false }),
          })
      );
      render(<OrderRefundPanel orderId="order-1" />);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Record manual refund' })
      );
      expect(
        await screen.findByRole('button', { name: 'Save manual refund' })
      ).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Save manual refund' })
        ).not.toBeInTheDocument();
      });
      expect(
        screen.queryByRole('button', { name: 'Record manual refund' })
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it('closes the manual form when polling revokes manage access', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => summary,
          })
          .mockResolvedValue({
            ok: true,
            json: async () => ({ ...summary, canManageRefunds: false }),
          })
      );
      render(<OrderRefundPanel orderId="order-1" />);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Record manual refund' })
      );
      expect(
        await screen.findByRole('button', { name: 'Save manual refund' })
      ).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Save manual refund' })
        ).not.toBeInTheDocument();
      });
      expect(
        screen.queryByRole('button', { name: 'Record manual refund' })
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

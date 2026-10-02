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
    expect(
      screen.getByText('Insufficient balance to process refund')
    ).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/orders/order-1/refund', {
        action: 'retry',
      })
    );
    expect(await screen.findByText('Queued')).toBeInTheDocument();
  });
  it('requires confirmation when recording money already returned', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      ...summary,
      status: 'refunded',
      refunded: 27574.83,
      remaining: 0,
      canRetry: false,
      canRecordManual: false,
    });
    render(<OrderRefundPanel orderId="order-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record manual refund' })
    );
    expect(
      screen.getByRole('button', { name: 'Save manual refund' })
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Refund date and time'), {
      target: { value: '2026-09-28T13:00' },
    });
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: 'bank-1' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save manual refund' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/api/orders/order-1/refund',
        expect.objectContaining({
          action: 'manual',
          amount: 27574.83,
          confirmed: true,
          reference: 'bank-1',
        })
      )
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Refunded');
    expect(
      screen.queryByRole('button', { name: 'Retry refund' })
    ).not.toBeInTheDocument();
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
});

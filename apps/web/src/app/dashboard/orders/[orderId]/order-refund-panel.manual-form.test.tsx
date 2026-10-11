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
describe('OrderRefundPanel manual form', () => {
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
  it('clears transfer fields after a partial manual refund', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      ...summary,
      status: 'failed',
      refunded: 7574.83,
      remaining: 20000,
      canRetry: true,
      canRecordManual: true,
    });
    render(<OrderRefundPanel orderId="order-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record manual refund' })
    );
    fireEvent.change(screen.getByLabelText('Refund date and time'), {
      target: { value: '2026-09-28T13:00' },
    });
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: 'bank-1' },
    });
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'first transfer' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save manual refund' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Save manual refund' })
      ).not.toBeInTheDocument()
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Record manual refund' })
    );
    expect(screen.getByLabelText('Reference')).toHaveValue('');
    expect(screen.getByLabelText('Refund date and time')).toHaveValue('');
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('');
    expect(screen.getByLabelText(/Amount/)).toHaveValue(20000);
  });
});

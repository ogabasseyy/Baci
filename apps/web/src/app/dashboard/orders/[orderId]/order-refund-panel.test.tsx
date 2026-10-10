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
    // Worker errors render a fixed label; the raw string stays in
    // the title for support, never as visible merchant-facing text.
    const label = screen.getByText(
      'The refund ran into a problem. Support has the details.'
    );
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute(
      'title',
      'Insufficient balance to process refund'
    );
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
  it('validates manual amount and date before submitting', async () => {
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
    fireEvent.click(screen.getByRole('checkbox'));
    // Native input validation (required/min/type) runs before submit
    // handlers, so submit the form directly to exercise the guards.
    const form = screen
      .getByRole('button', { name: 'Save manual refund' })
      .closest('form');
    if (!form) throw new Error('expected the manual refund form');
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: '-5' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid refund amount greater than zero.'
    );
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText('Refund date and time'), {
      target: { value: 'not-a-date' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid refund date and time.'
    );
    expect(apiPost).not.toHaveBeenCalled();
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
});

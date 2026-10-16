import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '@/lib/api-client';
import { OrderRefundPanel } from './order-refund-panel';

const legs = [
  {
    amount: 100,
    gateway: 'paystack',
    id: 'leg-1',
    outstanding: 100,
    reference: 'cap-1',
  },
  {
    amount: 100,
    gateway: 'paystack',
    id: 'leg-2',
    outstanding: 100,
    reference: 'cap-2',
  },
];
const summary = {
  amountPaid: 200,
  attempts: 1,
  canManageRefunds: true,
  canRecordManual: true,
  canRetry: true,
  currency: 'NGN',
  error: null,
  history: [],
  legs,
  pending: 0,
  refunded: 0,
  remaining: 200,
  retryRequests: 0,
  status: 'failed',
};

describe('OrderRefundPanel capture pin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('drops a pinned capture the poll covers before submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ json: async () => summary, ok: true })
        .mockResolvedValue({
          json: async () => ({ ...summary, legs: [legs[1]] }),
          ok: true,
        })
    );
    vi.mocked(apiPost).mockResolvedValue({
      ...summary,
      legs: [legs[1]],
      refunded: 200,
      remaining: 0,
    });
    render(<OrderRefundPanel orderId="order-1" />);
    const recordPromise = screen.findByRole('button', {
      name: 'Record manual refund',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(await recordPromise);
    fireEvent.change(screen.getByLabelText('Method'), {
      target: { value: 'paystack' },
    });
    fireEvent.change(screen.getByLabelText('Paystack capture'), {
      target: { value: 'leg-1' },
    });
    // The 30s poll covers the pinned capture while the form stands
    // open: the selector hides with a sole remaining leg. React's
    // render flush needs a real macrotask turn past the fake-timer
    // advance, so drop back to real timers for the assertions.
    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Paystack capture')
      ).not.toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/Refund date and time/), {
      target: { value: '2026-09-28T13:00' },
    });
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: 'bank-1' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save manual refund' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // The stale pin must not submit: the RPC would reject a covered
    // leg, leaving a valid-looking form that cannot save.
    const payload = vi.mocked(apiPost).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('paymentTransactionId');
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderRefundPanel } from './order-refund-panel';

const summary = {
  currency: 'NGN',
  amountPaid: 100,
  refunded: 0,
  remaining: 100,
  pending: 0,
  status: 'failed',
  error: 'The refund ran into a problem. Support has the details.',
  attempts: 5,
  retryRequests: 0,
  canRetry: true,
  canRecordManual: true,
  canManageRefunds: true,
  history: [],
  legs: [
    {
      amount: 100,
      gateway: 'paystack',
      id: 'leg-1',
      outstanding: 50,
      reference: 'cap-1',
    },
  ],
};
describe('OrderRefundPanel prefill cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => summary })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('reopens with the capture cap when Paystack stays selected', async () => {
    render(<OrderRefundPanel orderId="order-1" />);
    const record = await screen.findByRole('button', {
      name: 'Record manual refund',
    });
    fireEvent.click(record);
    // Switch to Paystack: the sole capture snaps the prefill to 50.
    fireEvent.change(screen.getByLabelText('Method'), {
      target: { value: 'paystack' },
    });
    expect((screen.getByLabelText(/Amount/) as HTMLInputElement).value).toBe(
      '50.00'
    );
    // Close and reopen with Paystack retained: no leg change fires
    // to snap, so the reopen prefill itself must respect the cap.
    fireEvent.click(record);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record manual refund' })
    );
    expect((screen.getByLabelText(/Amount/) as HTMLInputElement).value).toBe(
      '50.00'
    );
  });
});

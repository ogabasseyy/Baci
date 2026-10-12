import { fireEvent, render, screen } from '@testing-library/react';
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
  error: 'The refund ran into a problem. Support has the details.',
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
  it('validates manual amount and date before submitting', async () => {
    render(<OrderRefundPanel orderId="order-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record manual refund' })
    );
    fireEvent.change(screen.getByLabelText(/Refund date and time/), {
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
    fireEvent.change(screen.getByLabelText(/Refund date and time/), {
      target: { value: 'not-a-date' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid refund date and time.'
    );
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('validates reference, confirmation, and decimals before submitting', async () => {
    render(<OrderRefundPanel orderId="order-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record manual refund' })
    );
    fireEvent.change(screen.getByLabelText(/Refund date and time/), {
      target: { value: '2026-09-28T13:00' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: '10' },
    });
    const form = screen
      .getByRole('button', { name: 'Save manual refund' })
      .closest('form');
    if (!form) throw new Error('expected the manual refund form');
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: '' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter the transfer reference.'
    );
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: 'bank-1' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: '10.291' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'at most two decimals'
    );
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: '10' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Confirm that the money already moved.'
    );
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('submits the Lagos-offset instant from any viewer timezone', async () => {
    const previous = process.env.TZ;
    try {
      // A viewer 13 hours ahead of Lagos must still record the
      // Nigeria wall time the merchant typed, not a shifted instant.
      process.env.TZ = 'Pacific/Kiritimati';
      vi.mocked(apiPost).mockResolvedValue({ ...summary, status: 'queued' });
      render(<OrderRefundPanel orderId="order-1" />);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Record manual refund' })
      );
      fireEvent.change(screen.getByLabelText(/Refund date and time/), {
        target: { value: '2026-09-28T13:00' },
      });
      fireEvent.change(screen.getByLabelText(/Amount/), {
        target: { value: '100' },
      });
      fireEvent.change(screen.getByLabelText('Reference'), {
        target: { value: 'bank-1' },
      });
      fireEvent.click(screen.getByRole('checkbox'));
      const form = screen
        .getByRole('button', { name: 'Save manual refund' })
        .closest('form');
      if (!form) throw new Error('expected the manual refund form');
      fireEvent.submit(form);
      expect(apiPost).toHaveBeenCalledWith(
        '/api/orders/order-1/refund',
        expect.objectContaining({
          action: 'manual',
          refundedAt: '2026-09-28T13:00:00+01:00',
        })
      );
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it('prefills the manual amount without float artifacts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...summary, remaining: 0.1 + 0.2 }),
      })
    );
    render(<OrderRefundPanel orderId="order-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record manual refund' })
    );
    expect((screen.getByLabelText(/Amount/) as HTMLInputElement).value).toBe(
      '0.30'
    );
  });
  it('pins the selected capture for ambiguous Paystack records', async () => {
    const legs = [
      {
        amount: 100,
        gateway: 'paystack',
        id: 'leg-1',
        outstanding: 100,
        reference: 'pp-a',
      },
      {
        amount: 100,
        gateway: 'paystack',
        id: 'leg-2',
        outstanding: 100,
        reference: 'pp-b',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...summary, legs }),
      })
    );
    vi.mocked(apiPost).mockResolvedValue({
      ...summary,
      legs,
      status: 'queued',
    });
    render(<OrderRefundPanel orderId="order-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Record manual refund' })
    );
    fireEvent.change(screen.getByLabelText('Method'), {
      target: { value: 'paystack' },
    });
    fireEvent.change(screen.getByLabelText(/Refund date and time/), {
      target: { value: '2026-09-28T13:00' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: 'pin-1' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    const form = screen
      .getByRole('button', { name: 'Save manual refund' })
      .closest('form');
    if (!form) throw new Error('expected the manual refund form');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select which Paystack capture'
    );
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Paystack capture'), {
      target: { value: 'leg-2' },
    });
    fireEvent.submit(form);
    expect(apiPost).toHaveBeenCalledWith(
      '/api/orders/order-1/refund',
      expect.objectContaining({
        action: 'manual',
        paymentTransactionId: 'leg-2',
      })
    );
  });
});

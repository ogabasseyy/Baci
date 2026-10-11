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
          recorded_by: null,
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
});

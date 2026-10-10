import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({ apiPost: vi.fn() }));

import type { Order } from '../actions';
import { OrderRefundSection } from './order-refund-section';

const summary = {
  currency: 'NGN',
  amountPaid: 100,
  refunded: 0,
  remaining: 100,
  pending: 0,
  status: 'failed',
  error: null,
  attempts: 1,
  retryRequests: 0,
  canRetry: false,
  canRecordManual: false,
  canManageRefunds: true,
  history: [],
};

function orderWith(overrides: Partial<Order>): Order {
  return {
    id: 'order-1',
    paymentStatus: 'Paid',
    shippingStatus: 'Cancelled',
    ...overrides,
  } as Order;
}

describe('OrderRefundSection', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => summary })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('renders the refund panel only for cancelled orders', async () => {
    const setOrder = vi.fn();
    const { rerender } = render(
      <OrderRefundSection order={orderWith({})} setOrder={setOrder} />
    );
    expect(await screen.findByText('Refund')).toBeInTheDocument();
    rerender(
      <OrderRefundSection
        order={orderWith({ shippingStatus: 'Processing' })}
        setOrder={setOrder}
      />
    );
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
  });
  it('hides the refund panel for unpaid cancelled orders', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({ paymentStatus: 'Unpaid' })}
        setOrder={setOrder}
      />
    );
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('marks the order refunded when the panel reports completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...summary, status: 'refunded' }),
      })
    );
    const setOrder = vi.fn();
    render(<OrderRefundSection order={orderWith({})} setOrder={setOrder} />);
    await waitFor(() => expect(setOrder).toHaveBeenCalled());
    const updater = setOrder.mock.calls[0][0] as (prev: Order) => Order;
    expect(updater(orderWith({}))).toEqual(
      expect.objectContaining({ paymentStatus: 'Refunded' })
    );
    const already = orderWith({ paymentStatus: 'Refunded' });
    expect(updater(already)).toBe(already);
  });
});

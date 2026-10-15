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
        order={orderWith({ paymentStatus: 'Unpaid', transactions: [] })}
        setOrder={setOrder}
      />
    );
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('shows the refund panel when funding is unknown', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({ paymentStatus: 'Pending', transactions: undefined })}
        setOrder={setOrder}
      />
    );
    // A failed transactions read fails open so recovery stays
    // visible; the panel RPC remains the permission gate.
    expect(await screen.findByText('Refund')).toBeInTheDocument();
  });
  it('shows the refund panel for BNPL-approved cancelled orders', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({
          paymentStatus: 'Bnpl Approved',
        })}
        setOrder={setOrder}
      />
    );
    expect(await screen.findByText('Refund')).toBeInTheDocument();
  });
  it('shows the refund panel for funded pending cancelled orders', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({
          paymentStatus: 'Pending',
          transactions: [
            {
              id: 'leg-1',
              transaction_type: 'payment',
              status: 'completed',
              amount: 100,
              currency: 'NGN',
              gateway: 'paystack',
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
        })}
        setOrder={setOrder}
      />
    );
    expect(await screen.findByText('Refund')).toBeInTheDocument();
  });
  it('shows the refund panel for mid-flight pending cancelled orders', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({
          paymentStatus: 'Pending',
          transactions: [
            {
              id: 'leg-1',
              transaction_type: 'payment',
              status: 'refund_pending',
              amount: 100,
              currency: 'NGN',
              gateway: 'paystack',
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
        })}
        setOrder={setOrder}
      />
    );
    expect(await screen.findByText('Refund')).toBeInTheDocument();
  });
  it('shows the refund panel for self-terminalized pending cancelled orders', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({
          paymentStatus: 'Pending',
          transactions: [
            {
              id: 'leg-1',
              transaction_type: 'payment',
              status: 'refunded',
              amount: 100,
              currency: 'NGN',
              gateway: 'paypal',
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
        })}
        setOrder={setOrder}
      />
    );
    // The claim finalizes self-terminal legs, so a failed or
    // exhausted legacy row still needs its status and retry action.
    expect(await screen.findByText('Refund')).toBeInTheDocument();
  });
  it('hides the refund panel for unfunded pending cancelled orders', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({ paymentStatus: 'Pending', transactions: [] })}
        setOrder={setOrder}
      />
    );
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('hides the refund panel when no payment leg moved money', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({
          paymentStatus: 'Pending',
          transactions: [
            {
              id: 'leg-1',
              transaction_type: 'payment',
              status: 'failed',
              amount: 100,
              currency: 'NGN',
              gateway: 'paystack',
              created_at: '2026-10-01T00:00:00Z',
            },
            {
              id: 'leg-2',
              transaction_type: 'refund',
              status: 'completed',
              amount: 100,
              currency: 'NGN',
              gateway: 'manual',
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
        })}
        setOrder={setOrder}
      />
    );
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('shows the refund panel for BNPL-approved cancelled orders', async () => {
    const setOrder = vi.fn();
    render(
      <OrderRefundSection
        order={orderWith({
          paymentStatus: 'Bnpl Approved' as Order['paymentStatus'],
        })}
        setOrder={setOrder}
      />
    );
    expect(await screen.findByText('Refund')).toBeInTheDocument();
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

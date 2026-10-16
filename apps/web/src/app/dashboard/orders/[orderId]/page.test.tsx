import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/merchant-server', () => ({ getMerchantForUser: vi.fn() }));
vi.mock('../actions', () => ({ getOrder: vi.fn() }));
vi.mock('@/lib/orders/should-show-order-refund-panel', () => ({
  shouldShowOrderRefundPanel: vi.fn(),
}));
vi.mock('./initial-refund-summary', () => ({
  getInitialRefundSummary: vi.fn(),
}));
vi.mock('./client-page', () => ({
  default: (props: {
    initialOrder: unknown;
    initialRefundSummary: unknown;
  }) => (
    <div
      data-testid="client-page"
      data-order={JSON.stringify(props.initialOrder)}
      data-summary={JSON.stringify(props.initialRefundSummary)}
    />
  ),
}));

import { notFound } from 'next/navigation';
import { getMerchantForUser } from '@/lib/merchant-server';
import { shouldShowOrderRefundPanel } from '@/lib/orders/should-show-order-refund-panel';
import { getOrder } from '../actions';
import OrderDetailsPage from './page';
import { getInitialRefundSummary } from './initial-refund-summary';

const merchant = { id: 'merchant-1' };
const order = { id: 'order-uuid-1', order_number: 'ORD-1' };
const summary = { status: 'failed' };
const params = Promise.resolve({ orderId: 'ORD-1' });

describe('OrderDetailsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMerchantForUser).mockResolvedValue({ merchant } as never);
    vi.mocked(getOrder).mockResolvedValue(order as never);
    vi.mocked(shouldShowOrderRefundPanel).mockReturnValue(true);
    vi.mocked(getInitialRefundSummary).mockResolvedValue(summary as never);
  });

  it('passes the canonical order id and server summary to the client page', async () => {
    const element = await OrderDetailsPage({ params });
    render(element);
    expect(getOrder).toHaveBeenCalledWith('merchant-1', 'ORD-1');
    expect(getInitialRefundSummary).toHaveBeenCalledWith('order-uuid-1');
    expect(screen.getByTestId('client-page')).toHaveAttribute(
      'data-summary',
      JSON.stringify(summary)
    );
  });

  it('skips the summary fetch when the panel cannot show', async () => {
    vi.mocked(shouldShowOrderRefundPanel).mockReturnValue(false);
    const element = await OrderDetailsPage({ params });
    render(element);
    expect(getInitialRefundSummary).not.toHaveBeenCalled();
    expect(screen.getByTestId('client-page')).toHaveAttribute(
      'data-summary',
      'null'
    );
  });

  it('returns notFound without a merchant', async () => {
    vi.mocked(getMerchantForUser).mockResolvedValue({ merchant: null } as never);
    await OrderDetailsPage({ params });
    expect(notFound).toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
  });

  it('returns notFound when the order is missing or fails to load', async () => {
    vi.mocked(getOrder).mockResolvedValueOnce(null as never);
    await OrderDetailsPage({ params });
    expect(notFound).toHaveBeenCalledTimes(1);
    vi.mocked(getOrder).mockRejectedValueOnce(new Error('down'));
    await OrderDetailsPage({ params });
    expect(notFound).toHaveBeenCalledTimes(2);
  });
});

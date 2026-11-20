import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultProps,
  mocks,
  resetFollowUpQueueMocks,
} from '@/test/fixtures/follow-up-queue-list';
import { FollowUpQueueList } from './FollowUpQueueList';

describe('FollowUpQueueList', () => {
  beforeEach(resetFollowUpQueueMocks);

  it('shows pull-to-refresh progress while cached merchant context revalidates', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          attempt_count: 1,
          created_at: '2026-07-27T08:00:00.000Z',
          customer_email: 'ada@example.test',
          customer_id: 'customer-1',
          customer_name: 'Ada Buyer',
          customer_phone: '+2348012345678',
          id: 'order-1',
          order_number: 'ORD-001',
          payment_method: 'card',
          payment_status: 'failed',
          total: 15000,
        },
      ],
      isFailedOrdersError: false,
      isRefreshing: true,
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });

    render(<FollowUpQueueList {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: 'Refresh follow-ups' })
    ).toHaveAttribute('data-refreshing', 'true');
  });

  it('routes pull-to-refresh to the queue recovery callback', () => {
    render(<FollowUpQueueList {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh follow-ups' }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('explains when a search excludes every available follow-up', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          attempt_count: 1,
          created_at: '2026-07-27T08:00:00.000Z',
          customer_email: 'ada@example.test',
          customer_id: 'customer-1',
          customer_name: 'Ada Buyer',
          customer_phone: '+2348012345678',
          id: 'order-1',
          order_number: 'ORD-001',
          payment_method: 'card',
          payment_status: 'failed',
          total: 15000,
        },
      ],
      isFailedOrdersError: false,
      isRefreshing: false,
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });

    render(<FollowUpQueueList {...defaultProps} searchQuery="not-a-match" />);

    expect(screen.getByText('No matching follow-ups')).toBeTruthy();
    expect(screen.queryByText('No issues')).toBeNull();
  });

  it.each([
    [' ord-002 ', true],
    ['8012345678', true],
    ['+234 (801) 234-5678', true],
    ['234', false],
  ])('matches a guest follow-up search for %s (%s)', (searchQuery, matched) => {
    const order = {
      id: 'order-2',
      created_at: '2026-07-27T08:00:00Z',
      customer_name: 'Guest',
      customer_email: '',
      customer_phone: '+2348012345678',
      order_number: 'ORD-002',
    };
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [order],
      isFailedOrdersError: false,
      isRefreshing: false,
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });

    render(<FollowUpQueueList {...defaultProps} searchQuery={searchQuery} />);

    if (matched) {
      expect(defaultProps.renderOrder).toHaveBeenCalledWith(order, '₦');
    } else {
      expect(defaultProps.renderOrder).not.toHaveBeenCalled();
    }
  });

  it('keeps the limit notice visible for a filtered-empty result without Retry', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          id: 'order-1',
          created_at: '2026-07-27T08:00:00Z',
          customer_name: 'Ada',
          customer_email: '',
        },
      ],
      isFailedOrdersError: false,
      isFollowUpLimited: true,
      isRefreshing: false,
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    render(<FollowUpQueueList {...defaultProps} searchQuery="no-match" />);
    expect(screen.getByText(/This queue has reached its limit/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Retry loading follow-ups' })
    ).toBeNull();
  });

  it('keeps the partial-results warning visible when search filters out loaded rows', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          id: 'order-1',
          created_at: '2026-07-27T08:00:00Z',
          customer_email: 'ada@example.test',
          customer_name: 'Ada',
        },
      ],
      isFailedOrdersError: true,
      isRefreshing: false,
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    render(<FollowUpQueueList {...defaultProps} searchQuery="no-match" />);
    expect(
      screen.getByText(
        "Some follow-ups couldn't be loaded or may be out of date."
      )
    ).toBeTruthy();
  });
});

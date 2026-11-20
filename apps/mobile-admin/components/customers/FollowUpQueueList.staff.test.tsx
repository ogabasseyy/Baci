import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultProps,
  mocks,
  resetFollowUpQueueMocks,
} from '@/test/fixtures/follow-up-queue-list';
import { FollowUpQueueList } from './FollowUpQueueList';

describe('FollowUpQueueList', () => {
  beforeEach(resetFollowUpQueueMocks);

  it('shows a teammate’s outcome and next date in the queue and opens the editor', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          id: 'order-1',
          created_at: '2026-07-27T08:00:00Z',
          customer_name: 'Ada',
        },
      ],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      data: {
        'order-1': {
          assignee_id: 'teammate',
          assignee_name: 'Tola',
          stage: 'waiting',
          outcome: 'Asked the customer to retry.',
          follow_up_on: '2026-12-01',
          revision: 2,
        },
      },
    });

    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    expect(screen.getByText('Waiting · Tola')).toBeVisible();
    expect(screen.getByText('Asked the customer to retry.')).toBeVisible();
    expect(screen.getByText('Follow up on 2026-12-01')).toBeVisible();
    fireEvent.click(screen.getByText('View follow-up'));
    expect(screen.getByText('Open follow-up editor')).toBeVisible();
  });

  it('removes closed checkouts from the work queue and its count', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      data: { 'order-1': { stage: 'closed' } },
    });
    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );
    expect(screen.queryByText('Ada')).toBeNull();
    expect(
      screen.getByText('No follow-ups need attention right now.')
    ).toBeVisible();
    expect(defaultProps.onFollowUpCountChange).toHaveBeenLastCalledWith(0);
  });

  it('keeps the checkout provider status on a follow-up still present in the checkout feed', () => {
    const order = {
      id: 'order-1',
      created_at: '2026-07-27T08:00:00Z',
      payment_method: 'oxygen',
      oxygen_follow_up_status: 'needs_review',
    };
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [order],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      openOrders: [
        {
          ...order,
          oxygen_follow_up_status: undefined,
          staff_follow_up_only: true,
        },
      ],
      data: { 'order-1': { stage: 'waiting' } },
    });
    render(<FollowUpQueueList {...defaultProps} />);
    expect(defaultProps.renderOrder).toHaveBeenCalledExactlyOnceWith(
      order,
      '₦'
    );
    expect(defaultProps.onFollowUpCountChange).toHaveBeenLastCalledWith(1);
  });

  it('keeps a claimed follow-up visible after the checkout leaves the source queue', () => {
    const order = {
      id: 'order-1',
      created_at: '2026-07-27T08:00:00Z',
      customer_name: 'Ada',
    };
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      openOrders: [order],
      data: {
        'order-1': {
          assignee_id: 'teammate',
          assignee_name: 'Tola',
          stage: 'waiting',
          follow_up_on: '2026-12-01',
        },
      },
    });
    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );
    expect(screen.getByText('Waiting · Tola')).toBeVisible();
    expect(screen.getByText('Follow up on 2026-12-01')).toBeVisible();
  });

  it('offers no claim or update action until the team follow-up details have loaded', () => {
    // Without the loaded state a card could show Claim for an order a teammate
    // already holds; the banner Retry is the recovery path.
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          id: 'order-1',
          created_at: '2026-07-27T08:00:00Z',
          customer_name: 'Ada',
        },
      ],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: false,
      isError: true,
      refetch: vi.fn(),
    });

    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    expect(screen.getByText('Ada')).toBeVisible();
    expect(screen.queryByText('Claim follow-up')).toBeNull();
    expect(screen.queryByText('Update follow-up')).toBeNull();
  });

  it('shows an older order with an open claim as its own card beside the newest order of the same customer', () => {
    // useFailedOrders keeps only the newest order per email, so the older
    // order is not in the source queue; its open claim comes from the scan.
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          id: 'order-new',
          created_at: '2026-07-28T08:00:00Z',
          customer_name: 'Ada',
          customer_email: 'ada@example.test',
        },
      ],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      openOrders: [
        {
          id: 'order-old',
          created_at: '2026-07-27T08:00:00Z',
          customer_name: 'Ada',
          customer_email: 'ada@example.test',
        },
      ],
      data: {
        'order-old': {
          assignee_id: 'teammate',
          assignee_name: 'Tola',
          stage: 'contacted',
          outcome: 'Left a voicemail.',
          follow_up_on: null,
        },
      },
    });

    render(
      <FollowUpQueueList
        {...defaultProps}
        renderOrder={(order) => <div>{`Order ${order.id}`}</div>}
      />
    );

    expect(screen.getByText('Order order-new')).toBeVisible();
    expect(screen.getByText('Needs follow-up · Unassigned')).toBeVisible();
    expect(screen.getByText('Order order-old')).toBeVisible();
    expect(screen.getByText('Contacted · Tola')).toBeVisible();
    expect(screen.getByText('Left a voicemail.')).toBeVisible();
  });

  it('keeps an orphaned open follow-up claimable after its checkout leaves the source queue', () => {
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      openOrders: [
        {
          id: 'order-1',
          created_at: '2026-07-27T08:00:00Z',
          customer_name: 'Ada',
        },
      ],
      data: {
        'order-1': {
          assignee_id: null,
          assignee_name: 'Former teammate',
          stage: 'waiting',
          outcome: '',
          follow_up_on: null,
        },
      },
    });

    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    expect(screen.getByText('Waiting · Unassigned')).toBeVisible();
    expect(screen.queryByText('Former teammate')).toBeNull();
    expect(screen.getByText('Claim follow-up')).toBeVisible();
  });
});

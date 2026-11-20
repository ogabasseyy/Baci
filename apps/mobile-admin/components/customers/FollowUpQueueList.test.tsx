import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupedFailedOrderListItem } from '@/lib/customers-failed-orders';
import { FollowUpQueueList } from './FollowUpQueueList';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  useFollowUpQueue: vi.fn(),
  useStaffOrderFollowUps: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'viewer' } }),
}));
vi.mock('@/hooks/useStaffOrderFollowUps', () => ({
  useStaffOrderFollowUps: () => ({
    resetSave: vi.fn(),
    ...mocks.useStaffOrderFollowUps(),
  }),
}));
vi.mock('@/components/customers/StaffFollowUpEditor', () => ({
  StaffFollowUpEditor: (props: {
    justClaimed?: boolean;
    saveError?: string;
    onClaim: () => Promise<unknown>;
    onClose: () => void;
  }) => (
    <div>
      Open follow-up editor
      {props.saveError ? <span role="alert">{props.saveError}</span> : null}
      {props.justClaimed ? <span>Claim confirmed</span> : null}
      <button type="button" onClick={() => void props.onClaim()}>
        Claim from editor
      </button>
      <button type="button" onClick={props.onClose}>
        Close editor
      </button>
    </div>
  ),
}));

vi.mock('@shopify/flash-list', async () => {
  const React = await import('react');
  return {
    FlashList: ({
      data,
      ListEmptyComponent,
      ListHeaderComponent,
      refreshControl,
      renderItem,
    }: {
      data?: GroupedFailedOrderListItem[] | null;
      renderItem: (info: {
        item: GroupedFailedOrderListItem;
      }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      refreshControl?: React.ReactNode;
    }) => {
      const refreshProps = React.isValidElement(refreshControl)
        ? (refreshControl.props as {
            onRefresh?: () => void;
            refreshing?: boolean;
          })
        : undefined;

      return React.createElement(
        React.Fragment,
        null,
        ListHeaderComponent,
        React.createElement(
          'button',
          {
            'aria-label': 'Refresh follow-ups',
            'data-refreshing': String(Boolean(refreshProps?.refreshing)),
            onClick: refreshProps?.onRefresh,
            type: 'button',
          },
          'Refresh follow-ups'
        ),
        data?.length
          ? data
              .filter((item) => item.type !== 'header')
              .map((item) => renderItem({ item }))
          : ListEmptyComponent
      );
    },
  };
});

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null) };
});

vi.mock('@/hooks/useFollowUpQueue', () => ({
  useFollowUpQueue: mocks.useFollowUpQueue,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000000',
      backgroundLight: '#f2f2f7',
      error: '#ff3b30',
      gold: '#e6b800',
      primary: '#0a84ff',
      primaryLight: '#e6f2ff',
      success: '#34c759',
      text: '#ffffff',
      textMuted: '#666666',
      textSecondary: '#aeaeb2',
      warning: '#ff9500',
    },
  }),
}));

const defaultProps = {
  currencySymbol: '₦',
  onFollowUpCountChange: vi.fn(),
  onScroll: vi.fn(),
  renderOrder: vi.fn(() => null),
  searchQuery: '',
};

describe('FollowUpQueueList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: false,
      refetch: vi.fn(),
    });
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [],
      isFailedOrdersError: false,
      isRefreshing: false,
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'empty' },
    });
  });

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

  it('shows loading before reporting an empty queue while staff records are still being fetched', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({ isLoading: true });
    render(<FollowUpQueueList {...defaultProps} />);
    expect(screen.getByText('Loading follow-ups…')).toBeVisible();
    expect(screen.queryByText('No issues')).toBeNull();
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

  it('preserves a claim conflict when refreshing changes the editor revision', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({ isSuccess: true });
    const props = { ...defaultProps, renderOrder: () => <div>Ada</div> };
    const { rerender } = render(<FollowUpQueueList {...props} />);
    fireEvent.click(screen.getByText('Claim follow-up'));
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      data: {
        'order-1': { stage: 'waiting', assignee_id: 'teammate', revision: 1 },
      },
      saveError: 'Someone else has already claimed this follow-up.',
    });
    rerender(<FollowUpQueueList {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Someone else has already claimed this follow-up.'
    );
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

  it('tells the editor a claim just succeeded and clears that when the editor closes', async () => {
    const save = vi.fn().mockResolvedValue({ order_id: 'order-1' });
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
      data: {},
      save,
    });

    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    fireEvent.click(screen.getByText('Claim follow-up'));
    expect(screen.queryByText('Claim confirmed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Claim from editor' }));
    expect(await screen.findByText('Claim confirmed')).toBeVisible();
    expect(save).toHaveBeenCalledWith({ type: 'claim', orderId: 'order-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByText('Claim follow-up'));
    expect(screen.queryByText('Claim confirmed')).toBeNull();
  });
});

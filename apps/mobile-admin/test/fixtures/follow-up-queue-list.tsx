import type React from 'react';
import { vi } from 'vitest';
import type { GroupedFailedOrderListItem } from '@/lib/customers-failed-orders';

const mocks = vi.hoisted(() => ({
  flashListExtraData: vi.fn(),
  refresh: vi.fn(),
  useFollowUpQueue: vi.fn(),
  useStaffOrderFollowUps: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'viewer' } }),
}));
vi.mock('@/hooks/useStaffOrderFollowUps', () => ({
  useStaffOrderFollowUps: () => ({
    canWrite: true,
    refetchWriteAccess: vi.fn(),
    resetSave: vi.fn(),
    ...mocks.useStaffOrderFollowUps(),
  }),
}));
vi.mock('@/components/customers/StaffFollowUpEditor', () => ({
  StaffFollowUpEditor: (props: {
    canWrite: boolean;
    justClaimed?: boolean;
    saveError?: string;
    onClaim: () => Promise<unknown>;
    onClose: () => void;
  }) => (
    <div>
      Open follow-up editor
      {props.saveError ? <span role="alert">{props.saveError}</span> : null}
      {props.justClaimed ? <span>Claim confirmed</span> : null}
      <button
        type="button"
        disabled={!props.canWrite}
        onClick={() => void props.onClaim()}
      >
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
      extraData,
      ListEmptyComponent,
      ListHeaderComponent,
      refreshControl,
      renderItem,
    }: {
      data?: GroupedFailedOrderListItem[] | null;
      extraData?: unknown;
      renderItem: (info: {
        item: GroupedFailedOrderListItem;
      }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      refreshControl?: React.ReactNode;
    }) => {
      mocks.flashListExtraData(extraData);
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

export const defaultProps = {
  currencySymbol: '₦',
  onFollowUpCountChange: vi.fn(),
  onScroll: vi.fn(),
  renderOrder: vi.fn(() => null),
  searchQuery: '',
};

export function resetFollowUpQueueMocks() {
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
}

export { mocks };

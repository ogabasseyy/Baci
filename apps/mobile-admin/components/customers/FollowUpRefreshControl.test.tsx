import '@testing-library/jest-dom/vitest';
import '@/test/fixtures/customer-screen-follow-up-mocks';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomersScreen from '../../app/(admin)/(tabs)/customers';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  refetchFailed: vi.fn(),
  refetchOxygen: vi.fn(),
  useCustomerStats: vi.fn(),
  useCustomers: vi.fn(),
  useFailedOrders: vi.fn(),
  useOxygenFollowUps: vi.fn(),
  useMerchant: vi.fn(),
}));

vi.mock('@shopify/flash-list', async () => {
  const React = await import('react');

  return {
    FlashList: ({
      data,
      ListEmptyComponent,
      refreshControl,
    }: {
      data?: unknown[] | null;
      ListEmptyComponent?: React.ReactNode;
      refreshControl?: React.ReactNode;
    }) => {
      const onRefresh = React.isValidElement(refreshControl)
        ? (refreshControl.props as { onRefresh?: () => void }).onRefresh
        : undefined;
      const refreshing = React.isValidElement(refreshControl)
        ? (refreshControl.props as { refreshing?: boolean }).refreshing
        : undefined;

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          {
            'aria-label': 'Refresh follow-ups',
            'data-refreshing': String(Boolean(refreshing)),
            onClick: onRefresh,
            type: 'button',
          },
          'Refresh follow-ups'
        ),
        data && data.length > 0 ? null : ListEmptyComponent
      );
    },
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null) };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn() },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('expo-linking', () => ({
  createURL: vi.fn(() => 'baciadmin://'),
  openURL: vi.fn(),
  parse: vi.fn(() => ({ queryParams: {} })),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000000',
      backgroundLight: '#f2f2f7',
      card: '#1c1c1e',
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
    isDark: true,
    shadows: { sm: {} },
  }),
}));

vi.mock('@/hooks/useCustomers', () => ({
  useCustomerStats: mocks.useCustomerStats,
  useCustomers: mocks.useCustomers,
}));

vi.mock('@/hooks/useFailedOrders', () => ({
  useFailedOrders: mocks.useFailedOrders,
}));

vi.mock('@/hooks/useOxygenFollowUps', () => ({
  useOxygenFollowUps: mocks.useOxygenFollowUps,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: mocks.useMerchant,
}));

vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

describe('CustomersScreen Follow Up pull-to-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useCustomers.mockReturnValue({
      data: { pages: [{ customers: [] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    mocks.useCustomerStats.mockReturnValue({
      data: { newThisWeek: 0, retentionRate: 0, total: 0 },
    });
    mocks.useMerchant.mockReturnValue({
      error: new Error('merchant context failed'),
      isLoading: false,
      merchant: null,
    });
    mocks.useFailedOrders.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: [],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });
  });

  it('recovers merchant context instead of refetching a disabled Follow Up query', () => {
    render(<CustomersScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh follow-ups' }));

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant'],
    });
    expect(mocks.refetchFailed).not.toHaveBeenCalled();
  });

  it('shows an honest empty state when search removes every Follow Up row', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });
    mocks.useFailedOrders.mockReturnValue({
      data: [
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
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });

    render(<CustomersScreen />);

    fireEvent.change(screen.getByLabelText('Search customers'), {
      target: { value: 'not-a-match' },
    });

    expect(screen.getByText('No matching follow-ups')).toBeTruthy();
    expect(screen.queryByText('No issues')).toBeNull();
  });

  it('shows pull-to-refresh progress while a cached merchant context revalidates', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isFetching: true,
      isLoading: false,
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });
    mocks.useFailedOrders.mockReturnValue({
      data: [
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
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });

    render(<CustomersScreen />);

    expect(
      screen.getByRole('button', { name: 'Refresh follow-ups' })
    ).toHaveAttribute('data-refreshing', 'true');
  });
});

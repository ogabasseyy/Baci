import '@testing-library/jest-dom/vitest';
import '@/test/fixtures/customer-screen-follow-up-mocks';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomersScreen from '@/app/(admin)/(tabs)/customers';
import { oxygenProcessingOrder } from '@/test/fixtures/oxygen-follow-up';

vi.mock('@shopify/flash-list', async () => {
  const React = await import('react');
  return {
    FlashList: ({
      data,
      renderItem,
      ListEmptyComponent,
      onEndReached,
    }: {
      data?: unknown[] | null;
      renderItem: (params: { item: unknown; index: number }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
      onEndReached?: () => void;
    }) =>
      React.createElement(
        'div',
        null,
        data && data.length > 0
          ? data.map((item: unknown, index: number) =>
              renderItem({ item, index })
            )
          : ListEmptyComponent,
        React.createElement(
          'button',
          {
            'aria-label': 'reach customers list end',
            onClick: () => onEndReached?.(),
            type: 'button',
          },
          'reach end'
        )
      ),
  };
});

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', null),
  };
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
  openURL: vi.fn(),
  parse: vi.fn(() => ({ queryParams: {} })),
  createURL: vi.fn(() => 'baciadmin://'),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000000',
      card: '#1c1c1e',
      cardHover: '#2c2c2e',
      text: '#ffffff',
      textSecondary: '#aeaeb2',
      gold: '#e6b800',
      goldLight: '#fff9e6',
      success: '#34c759',
      successLight: '#eafaf1',
      backgroundLight: '#f2f2f7',
      error: '#ff3b30',
      warning: '#ff9500',
    },
    shadows: {
      sm: {},
    },
    isDark: true,
  }),
}));

const customerHookMocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  useCustomers: vi.fn(),
  useFailedOrders: vi.fn(),
  useOxygenFollowUps: vi.fn(),
  useCustomerStats: vi.fn(),
  useMerchant: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: customerHookMocks.invalidateQueries,
  }),
}));

vi.mock('@/hooks/useCustomers', () => ({
  useCustomers: customerHookMocks.useCustomers,
  useCustomerStats: customerHookMocks.useCustomerStats,
  CustomerItem: () => null,
}));

vi.mock('@/hooks/useFailedOrders', () => ({
  useFailedOrders: customerHookMocks.useFailedOrders,
}));
vi.mock('@/hooks/useOxygenFollowUps', () => ({
  useOxygenFollowUps: customerHookMocks.useOxygenFollowUps,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: customerHookMocks.useMerchant,
}));

describe('CustomersScreen UI rendering', () => {
  const fetchNextPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    customerHookMocks.useOxygenFollowUps.mockReturnValue({
      data: [],
      isError: false,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    customerHookMocks.useCustomers.mockReturnValue({
      data: { pages: [{ customers: [] }] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage,
      refetch: vi.fn(),
    });

    customerHookMocks.useFailedOrders.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });

    customerHookMocks.useCustomerStats.mockReturnValue({
      data: { total: 0, newThisWeek: 0, retentionRate: 0 },
    });

    customerHookMocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });
  });

  it('renders customers screen successfully', () => {
    const { getByText } = render(<CustomersScreen />);
    expect(getByText('Customers')).toBeTruthy();
  });
  it('shows an unavailable amount rather than zero for Oxygen', () => {
    customerHookMocks.useOxygenFollowUps.mockReturnValue({
      data: [
        {
          ...oxygenProcessingOrder,
          total: null,
          oxygen_follow_up_status: 'needs_review',
        },
      ],
      isError: false,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<CustomersScreen />);
    expect(screen.getByText(/Amount unavailable/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Amount unavailable/ })
    ).toBeTruthy();
  });

  it('keeps the customer tab rail constrained to chip height', () => {
    render(<CustomersScreen />);

    expect(screen.getByRole('tablist')).toHaveStyle({
      flexGrow: '0',
      maxHeight: '44px',
    });
  });

  it('opens customer tabs and passes the selected customer type filter', () => {
    render(<CustomersScreen />);

    expect(customerHookMocks.useCustomers).toHaveBeenLastCalledWith({
      customerType: undefined,
      search: '',
    });

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));

    expect(customerHookMocks.useCustomers).toHaveBeenLastCalledWith({
      customerType: 'individual',
      search: '',
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Companies' }));

    expect(customerHookMocks.useCustomers).toHaveBeenLastCalledWith({
      customerType: 'company',
      search: '',
    });
  });

  it('paginates People and Companies tabs when the list reaches the end', () => {
    customerHookMocks.useCustomers.mockReturnValue({
      data: {
        pages: [
          {
            customers: [
              {
                id: 'customer-1',
                full_name: 'Ada Person',
                email: 'ada@example.com',
                phone: null,
                total_spent: 0,
                order_count: 0,
              },
            ],
          },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'reach customers list end' })
    );
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Companies' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'reach customers list end' })
    );
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('renders empty states for failed orders and customer lists', () => {
    render(<CustomersScreen />);
    expect(screen.getByText('No issues')).toBeTruthy();
    expect(
      screen.getByText('No follow-ups need attention right now.')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));

    expect(screen.getByText('No customers yet')).toBeTruthy();
    expect(
      screen.getByText('Customers will appear here after their first purchase')
    ).toBeTruthy();
  });

  it('suppresses the failed-orders empty state while failed orders are loading', () => {
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: [],
      isLoading: true,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    expect(screen.queryByText('No issues')).toBeNull();
  });
  it('suppresses the customer empty state while customers are loading', () => {
    customerHookMocks.useCustomers.mockReturnValue({
      data: { pages: [{ customers: [] }] },
      isLoading: true,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));

    expect(screen.queryByText('No customers yet')).toBeNull();
  });
});

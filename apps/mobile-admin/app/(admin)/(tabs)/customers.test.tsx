import '@testing-library/jest-dom/vitest';
import '@/test/fixtures/customer-screen-follow-up-mocks';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { oxygenProcessingOrder } from '@/test/fixtures/oxygen-follow-up';
import CustomersScreen from './customers';

vi.mock('@shopify/flash-list', async () => {
  const React = await import('react');
  return {
    FlashList: ({
      data,
      renderItem,
      ListEmptyComponent,
      ListHeaderComponent,
    }: {
      data?: unknown[] | null;
      renderItem: (params: { item: unknown; index: number }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
    }) =>
      React.createElement(
        'div',
        null,
        ListHeaderComponent,
        data && data.length > 0
          ? data.map((item: unknown, index: number) =>
              renderItem({ item, index })
            )
          : ListEmptyComponent
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

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('expo-router', () => ({
  router: navigation,
  useRouter: () => navigation,
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
      backgroundLight: '#f2f2f7',
      card: '#1c1c1e',
      cardHover: '#2c2c2e',
      error: '#ff3b30',
      gold: '#e6b800',
      goldLight: '#fff9e6',
      primary: '#0a84ff',
      primaryLight: '#e6f2ff',
      success: '#34c759',
      successLight: '#eafaf1',
      text: '#ffffff',
      textSecondary: '#aeaeb2',
      warning: '#ff9500',
    },
    shadows: { sm: {} },
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

describe('CustomersScreen follow-up error surface', () => {
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
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    customerHookMocks.useCustomerStats.mockReturnValue({
      data: { total: 0, newThisWeek: 0, retentionRate: 0 },
    });
    customerHookMocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });
  });
  it('shows the Oxygen state on the follow-up card', () => {
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: [],
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    customerHookMocks.useOxygenFollowUps.mockReturnValue({
      data: [oxygenProcessingOrder],
      isError: false,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<CustomersScreen />);
    expect(screen.getByText(/Oxygen · Processing/)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /Follow up: Ada.*Oxygen · Processing/,
      })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: /Follow up: Ada.*Oxygen · Processing/,
      })
    );
    expect(navigation.push).toHaveBeenCalledWith({
      pathname: '/(admin)/order/[id]',
      params: { id: 'oxygen-1' },
    });
  });
  it('does not claim transactions are successful when the follow-up query errors', () => {
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    expect(
      screen.queryByText('No follow-ups need attention right now.')
    ).toBeNull();
    expect(screen.queryByText('No issues')).toBeNull();
    expect(screen.getByText("Couldn't load follow-ups")).toBeTruthy();
  });
  it('refetches follow-ups when the error state retry is pressed', () => {
    const refetch = vi.fn();
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      refetch,
    });
    render(<CustomersScreen />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading follow-ups' })
    );

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still reports success when the query succeeds with no follow-ups', () => {
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: [],
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    expect(screen.getByText('No issues')).toBeTruthy();
    expect(screen.queryByText("Couldn't load follow-ups")).toBeNull();
  });

  it('does not report no issues when merchant context fails and retries merchant context', () => {
    customerHookMocks.useMerchant.mockReturnValue({
      merchant: null,
      isLoading: false,
      error: new Error('merchant context failed'),
    });
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    expect(screen.queryByText('No issues')).toBeNull();
    expect(screen.getByText('Failed to load store')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading follow-ups' })
    );

    expect(customerHookMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant'],
    });
  });

  it('warns that rows are stale when a refresh fails over cached follow-ups', () => {
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: [
        {
          attempt_count: 1,
          created_at: '2026-07-24T10:00:00.000Z',
          customer_email: 'ada@example.com',
          customer_id: 'customer-1',
          customer_name: 'Ada Buyer',
          customer_phone: '+2348012345678',
          id: 'order-1',
          order_number: 'ORD-001',
          payment_method: 'credit_direct',
          payment_status: 'bnpl_pending',
          total: 15000,
        },
      ],
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    expect(
      screen.getByText(
        "Some follow-ups couldn't be loaded or may be out of date."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Retry loading follow-ups' })
    ).toBeTruthy();
  });

  it('disables the retry control while a retry is already in flight', () => {
    customerHookMocks.useFailedOrders.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: true,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<CustomersScreen />);

    const retry = screen.getByRole('button', {
      name: 'Retry loading follow-ups',
    });
    expect(retry).toBeDisabled();
    expect(screen.getByText('Retrying…')).toBeTruthy();
  });
});

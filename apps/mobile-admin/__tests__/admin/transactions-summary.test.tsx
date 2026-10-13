import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  appStateListener: vi.fn(),
  useLocalSearchParams: vi.fn(),
  mutateAsync: vi.fn(),
  routerPush: vi.fn(),
  useAnalyticsOverview: vi.fn(),
  useDebounce: vi.fn(),
  useMonthlyTransactionCount: vi.fn(),
  useTransactionReview: vi.fn(),
  useUpdateTransactionCostPrice: vi.fn(),
}));

vi.mock(
  'react-native',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.reactNative
);

vi.mock(
  'react-native-safe-area-context',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.safeArea
);

vi.mock(
  '@react-native-vector-icons/ionicons',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.ionicons
);

vi.mock(
  'expo-router',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.expoRouter
);

vi.mock(
  '@/hooks/useTheme',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.theme
);

vi.mock(
  '@/hooks/useCurrency',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.currency
);

vi.mock(
  '@/hooks/useAnalyticsOverview',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.analyticsOverview
);

vi.mock(
  '@/hooks/useTransactionReview',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.transactionReview
);

vi.mock(
  '@/hooks/useDebounce',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.debounce
);

vi.mock(
  '@/hooks/useMonthlyTransactionCount',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.monthlyCount
);

vi.mock(
  '@/hooks/useUpdateTransactionCostPrice',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.costPrice
);

vi.mock(
  '@/lib/search-transaction-review-orders',
  async () =>
    (
      await import('./transactions-screen-test-harness')
    ).createTransactionsScreenHarness(mocks).modules.searchLimit
);

vi.mock('@/components/transactions/TransactionsSummary', async () => ({
  TransactionsSummary: (await import('./transactions-screen-test-components'))
    .transactionsScreenTestComponents.TransactionsSummary,
}));

vi.mock('@/components/transactions/TransactionOrderCard', async () => ({
  TransactionOrderCard: (await import('./transactions-screen-test-components'))
    .transactionsScreenTestComponents.TransactionOrderCard,
}));

vi.mock('@/components/transactions/CostPriceEditorModal', async () => ({
  CostPriceEditorModal: (await import('./transactions-screen-test-components'))
    .transactionsScreenTestComponents.CostPriceEditorModal,
}));

import TransactionsScreen from '@/app/(admin)/transactions';
import { createTransactionsScreenHarness } from './transactions-screen-test-harness';

const { sampleOrders, wireDefaults } = createTransactionsScreenHarness(mocks);

describe('TransactionsScreen monthly summary', () => {
  beforeEach(() => {
    wireDefaults();
  });

  it('shows a placeholder missing-costs count while the range summary is pending', () => {
    mocks.useTransactionReview.mockImplementation(
      (
        _range: unknown,
        options?: {
          enabled?: boolean;
          fetchAllRange?: boolean;
          search?: string;
        }
      ) => {
        // The summary query passes { fetchAllRange } while the list query
        // passes { search }.
        if (options && 'fetchAllRange' in options) {
          return {
            data: undefined,
            error: null,
            isPending: true,
            refetch: vi.fn(),
          };
        }
        return {
          data: sampleOrders,
          error: null,
          isLoading: false,
          isPending: false,
          isRefetching: false,
          refetch: vi.fn(),
        };
      }
    );

    render(<TransactionsScreen />);

    expect(screen.getByText('-- missing costs')).toBeInTheDocument();
  });

  it('shows an unavailable missing-costs count when the range summary fails', () => {
    mocks.useTransactionReview.mockImplementation(
      (
        _range: unknown,
        options?: {
          enabled?: boolean;
          fetchAllRange?: boolean;
          search?: string;
        }
      ) => {
        if (options && 'fetchAllRange' in options) {
          return {
            data: [],
            error: new Error('range boom'),
            isPending: false,
            refetch: vi.fn(),
          };
        }
        return {
          data: sampleOrders,
          error: null,
          isLoading: false,
          isPending: false,
          isRefetching: false,
          refetch: vi.fn(),
        };
      }
    );

    render(<TransactionsScreen />);

    expect(screen.getByText('Unavailable missing costs')).toBeInTheDocument();
  });

  it('refreshes the monthly anchor at local midnight without reopening the screen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 30, 23, 59, 59));
    const view = render(<TransactionsScreen />);
    try {
      expect(screen.getByText('2 transactions')).toBeInTheDocument();
      const beforeMidnight =
        mocks.useMonthlyTransactionCount.mock.calls.at(-1)?.[0];
      expect(beforeMidnight.getMonth()).toBe(3);
      act(() => vi.advanceTimersByTime(1000));
      const afterMidnight =
        mocks.useMonthlyTransactionCount.mock.calls.at(-1)?.[0];
      expect(afterMidnight.getMonth()).toBe(4);
      expect(afterMidnight.getDate()).toBe(1);
      // Historical IMEIs remain searchable after the monthly reset.
      fireEvent.change(screen.getByLabelText('Search transactions'), {
        target: { value: '353232106161443' },
      });
      expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
      expect(screen.queryByText('Edit ORD-2')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('shows the monthly count without loading monthly rows', () => {
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: 41,
      error: null,
      refetch: vi.fn(),
    });
    render(<TransactionsScreen />);
    expect(screen.getByText('41 transactions')).toBeInTheDocument();
    expect(mocks.useTransactionReview).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fetchAll: true })
    );
  });

  it('shows a zero monthly count instead of a placeholder', () => {
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: 0,
      error: null,
      refetch: vi.fn(),
    });
    render(<TransactionsScreen />);
    expect(screen.getByText('0 transactions')).toBeInTheDocument();
  });

  it('shows a placeholder while the monthly count loads', () => {
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: undefined,
      error: null,
      refetch: vi.fn(),
    });
    render(<TransactionsScreen />);
    expect(screen.getByText('-- transactions')).toBeInTheDocument();
  });

  it('refreshes the monthly anchor after resuming in a new month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 30, 12));
    const view = render(<TransactionsScreen />);
    try {
      expect(screen.getByText('2 transactions')).toBeInTheDocument();
      vi.setSystemTime(new Date(2026, 4, 1, 12));
      const listener = mocks.appStateListener.mock.calls.at(-1)?.[1];
      act(() => listener('active'));
      const anchor = mocks.useMonthlyTransactionCount.mock.calls.at(-1)?.[0];
      expect(anchor.getMonth()).toBe(4);
      expect(anchor.getDate()).toBe(1);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('does not present an unavailable monthly count as zero', () => {
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: undefined,
      error: new Error('Monthly query failed'),
      refetch: vi.fn(),
    });
    render(<TransactionsScreen />);
    expect(screen.getByText('Unavailable transactions')).toBeInTheDocument();
    expect(screen.queryByText('0 transactions')).not.toBeInTheDocument();
  });
});

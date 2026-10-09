import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('TransactionsScreen search', () => {
  beforeEach(() => {
    wireDefaults();
  });

  it('searches historical IMEIs even when a date range is selected', () => {
    mocks.useLocalSearchParams.mockReturnValue({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
    mocks.useTransactionReview.mockImplementation((range) => ({
      data: range ? [] : sampleOrders,
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    }));
    render(<TransactionsScreen />);
    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: '353232106161443' },
    });
    expect(mocks.useDebounce).toHaveBeenCalledWith('353232106161443', 250);
    expect(mocks.useTransactionReview).toHaveBeenCalledWith(undefined, {
      search: '353232106161443',
      tab: 'paid',
    });
    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
  });

  it('discloses truncated search results from the hook signal', () => {
    mocks.useTransactionReview.mockImplementation((_range, options) => ({
      data: options?.search ? [sampleOrders[0]] : sampleOrders,
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
      searchTruncated: Boolean(options?.search),
    }));

    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: '353232106161443' },
    });

    expect(
      screen.getByText(
        'Showing 1 match (partial results). Refine your search to narrow results.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
  });

  it('keeps the range query enabled while searching', () => {
    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: '353232106161443' },
    });

    // The summary card renders during search: a disabled range query would
    // ignore cost-edit invalidations and show pre-edit values.
    const options = mocks.useTransactionReview.mock.calls.map(
      (call) => call[1] as { enabled?: boolean; fetchAllRange?: boolean }
    );
    expect(options.some((o) => o?.fetchAllRange === true)).toBe(true);
    expect(options.some((o) => o?.enabled === false)).toBe(false);
  });

  it('refines with the debounced query while searching', () => {
    mocks.useDebounce.mockImplementation(() => 'Efosa');

    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'Galaxy' },
    });

    expect(screen.queryByText('Edit ORD-1')).not.toBeInTheDocument();
    expect(screen.getByText('Edit ORD-2')).toBeInTheDocument();
  });

  it('holds the browse list while the debounced query lags behind typing', () => {
    mocks.useDebounce.mockImplementation(() => '');

    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'zzz-no-match-in-window' },
    });

    expect(
      screen.queryByText('No matching transactions.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.getByText('Edit ORD-2')).toBeInTheDocument();
  });

  it('shows no-matching when a server search returns nothing', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: [],
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'no-such-imei' },
    });

    expect(screen.getByText('No matching transactions.')).toBeInTheDocument();
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument();
  });

  it('keeps the missing-costs summary on the browsing list while searching', () => {
    mocks.useTransactionReview.mockImplementation((_range, options) => ({
      data: options?.search ? [sampleOrders[0]] : sampleOrders,
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    }));

    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: '353232106161443' },
    });

    expect(screen.getByText('1 missing costs')).toBeInTheDocument();
    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.queryByText('Edit ORD-2')).not.toBeInTheDocument();
  });
});

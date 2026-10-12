import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { buildTransactionDateIso } from '@/lib/transaction-review';
import { createTransactionsScreenHarness } from './transactions-screen-test-harness';

const { wireDefaults } = createTransactionsScreenHarness(mocks);

describe('TransactionsScreen', () => {
  beforeEach(() => {
    wireDefaults();
  });

  it('renders a loading state', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: [],
      error: null,
      isLoading: true,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<TransactionsScreen />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders a retryable error state when no transactions are available', () => {
    const refetch = vi.fn();
    const monthlyRefetch = vi.fn();
    const rangeRefetch = vi.fn();
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
            isLoading: false,
            isPending: false,
            isRefetching: false,
            refetch: rangeRefetch,
          };
        }
        return {
          data: [],
          error: new Error('boom'),
          isLoading: false,
          isPending: false,
          isRefetching: false,
          refetch,
        };
      }
    );
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: 2,
      error: null,
      refetch: monthlyRefetch,
    });

    render(<TransactionsScreen />);

    expect(
      screen.getByText('Unable to load transactions.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retry loading transactions'));
    expect(refetch).toHaveBeenCalled();
    expect(monthlyRefetch).toHaveBeenCalled();
    expect(rangeRefetch).toHaveBeenCalled();
  });

  it('renders an empty state when there are no transactions', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: [],
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<TransactionsScreen />);

    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
  });

  it('loads the estimated profit from the current-month analytics range', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

    try {
      render(<TransactionsScreen />);

      expect(mocks.useAnalyticsOverview).toHaveBeenCalledTimes(1);
      const [{ endDate, startDate }] = mocks.useAnalyticsOverview.mock.calls[0];
      expect(startDate.getFullYear()).toBe(2026);
      expect(startDate.getMonth()).toBe(4);
      expect(startDate.getDate()).toBe(1);
      expect(startDate.getHours()).toBe(0);
      expect(endDate.getFullYear()).toBe(2026);
      expect(endDate.getMonth()).toBe(4);
      expect(endDate.getDate()).toBe(25);
      expect(endDate.getHours()).toBe(23);
      expect(screen.getByText('₦1,250')).toBeInTheDocument();
      expect(screen.queryByText('₦4,000')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report zero profit while the monthly aggregate is loading', () => {
    mocks.useAnalyticsOverview.mockReturnValue({ data: undefined });

    render(<TransactionsScreen />);

    expect(screen.getByText('--')).toBeInTheDocument();
    expect(screen.queryByText('₦0')).not.toBeInTheDocument();
  });

  it('shows when the monthly estimated profit is unavailable', () => {
    mocks.useAnalyticsOverview.mockReturnValue({
      data: undefined,
      error: new Error('analytics unavailable'),
    });

    render(<TransactionsScreen />);

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('--')).not.toBeInTheDocument();
  });

  it('shows a validation error before saving an invalid cost price', async () => {
    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-1'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    expect(
      await screen.findByText('Enter a valid cost price (0 or greater).')
    ).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows a validation error before saving a negative cost price', async () => {
    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-1'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '-1200' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    expect(
      await screen.findByText('Enter a valid cost price (0 or greater).')
    ).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('saves a valid cost price update', async () => {
    const expectedTransactionDateIso = buildTransactionDateIso('2026-04-12');

    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-1'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '₦1,200' },
    });
    fireEvent.change(screen.getByLabelText('Transaction date input'), {
      target: { value: '2026-04-12' },
    });
    fireEvent.change(screen.getByLabelText('Vendor or supplier input'), {
      target: { value: 'new supplier' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        costPrice: 1200,
        orderId: 'order-1',
        orderItemId: 'item-1',
        productId: 'product-1',
        supplierName: 'New supplier',
        transactionDateIso: expectedTransactionDateIso,
        updateProductDefault: false,
        variantId: null,
      })
    );
  });

  it('saves unit-level transaction cost metadata when editing a fulfilled unit row', async () => {
    const expectedTransactionDateIso = buildTransactionDateIso('2026-04-10');
    mocks.useTransactionReview.mockReturnValue({
      data: [
        {
          createdAt: '2026-04-10T10:00:00.000Z',
          customerEmail: null,
          customerName: 'Kayode',
          customerPhone: null,
          estimatedProfit: 0,
          id: 'order-unit',
          items: [
            {
              costPrice: 850000,
              costSource: 'unit',
              imeiValues: [],
              id: 'item-laptop:2',
              name: 'HP EliteBook x360 1040 G10',
              orderItemId: 'item-laptop',
              productId: 'product-laptop',
              profit: 50000,
              quantity: 1,
              revenue: 900000,
              searchText: 'hp elitebook laptop-sn-2',
              serialValues: ['LAPTOP-SN-2'],
              sku: 'ELITEBOOK',
              supplierName: 'Supplier B',
              unitIndex: 1,
              variantId: null,
            },
          ],
          missingCostCount: 0,
          orderNumber: 'ORD-UNIT',
          paymentMethod: 'transfer',
          searchText: 'ord-unit hp elitebook laptop-sn-2',
          total: 900000,
        },
      ],
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-UNIT'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '₦870,000' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        costPrice: 870000,
        identifierType: 'serial',
        identifierValue: 'LAPTOP-SN-2',
        orderId: 'order-unit',
        orderItemId: 'item-laptop',
        productId: 'product-laptop',
        supplierName: 'Supplier b',
        transactionDateIso: expectedTransactionDateIso,
        unitIndex: 1,
        updateProductDefault: false,
        variantId: null,
      })
    );
  });

  it('asks for confirmation before saving a loss-making cost price', async () => {
    const expectedTransactionDateIso = buildTransactionDateIso('2026-04-10');

    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-1'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '₦6,000' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    const [, message, buttons] = mocks.alert.mock.calls[0];
    expect(message).toContain('loss of ₦1,000');
    expect(buttons?.map((button: { text?: string }) => button.text)).toEqual([
      'Cancel',
      'Record loss',
    ]);

    buttons?.[1]?.onPress?.();

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        costPrice: 6000,
        orderId: 'order-1',
        orderItemId: 'item-1',
        productId: 'product-1',
        supplierName: 'Old supplier',
        transactionDateIso: expectedTransactionDateIso,
        updateProductDefault: false,
        variantId: null,
      })
    );
  });

  it('opens and saves an unlinked custom transaction row', async () => {
    const expectedTransactionDateIso = buildTransactionDateIso('2026-04-10');
    mocks.useTransactionReview.mockReturnValue({
      data: [
        {
          createdAt: '2026-04-10T10:00:00.000Z',
          customerEmail: null,
          customerName: 'Custom Customer',
          customerPhone: null,
          estimatedProfit: 0,
          id: 'order-custom',
          items: [
            {
              costPrice: null,
              costSource: null,
              imeiValues: [],
              id: 'item-custom',
              name: 'Itel Buds Neo 3',
              productId: null,
              profit: null,
              quantity: 1,
              revenue: 20000,
              searchText: 'itel buds neo 3',
              serialValues: [],
              sku: null,
              supplierName: '',
              variantId: null,
            },
          ],
          missingCostCount: 1,
          orderNumber: 'ORD-CUSTOM',
          paymentMethod: 'transfer',
          searchText: 'ord-custom custom customer itel buds neo 3',
          total: 20000,
        },
      ],
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-CUSTOM'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '12000' },
    });
    fireEvent.change(screen.getByLabelText('Vendor or supplier input'), {
      target: { value: 'accessories vendor' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        costPrice: 12000,
        orderId: 'order-custom',
        orderItemId: 'item-custom',
        productId: null,
        supplierName: 'Accessories vendor',
        transactionDateIso: expectedTransactionDateIso,
        updateProductDefault: false,
        variantId: null,
      })
    );
  });

  it('preserves spaces while typing a supplier name before save', () => {
    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-1'));
    fireEvent.change(screen.getByLabelText('Vendor or supplier input'), {
      target: { value: 'main ' },
    });

    expect(screen.getByLabelText('Vendor or supplier input')).toHaveValue(
      'main '
    );
  });

  it('treats comma-separated cost price input as grouped digits on save', async () => {
    const expectedTransactionDateIso = buildTransactionDateIso('2026-04-10');

    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-1'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '12,5' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        costPrice: 125,
        orderId: 'order-1',
        orderItemId: 'item-1',
        productId: 'product-1',
        supplierName: 'Old supplier',
        transactionDateIso: expectedTransactionDateIso,
        updateProductDefault: false,
        variantId: null,
      })
    );
  });

  it('opens existing cost prices with currency symbol and comma formatting', () => {
    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-2'));

    expect(screen.getByLabelText('Cost price input')).toHaveValue('₦2,000');
  });

  it('preserves thousands separators as grouping while editing formatted prices', () => {
    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-2'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '₦2,0005' },
    });

    expect(screen.getByLabelText('Cost price input')).toHaveValue('₦20,005');

    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '₦20,00' },
    });

    expect(screen.getByLabelText('Cost price input')).toHaveValue('₦2,000');
  });

  it('filters visible transactions by IMEI', () => {
    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: '353232106161443' },
    });

    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.queryByText('Edit ORD-2')).not.toBeInTheDocument();
  });

  it('filters visible transactions by serial number', () => {
    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'SN-123' },
    });

    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.queryByText('Edit ORD-2')).not.toBeInTheDocument();
  });

  it('filters visible transactions by customer name', () => {
    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'Efosa' },
    });

    expect(screen.queryByText('Edit ORD-1')).not.toBeInTheDocument();
    expect(screen.getByText('Edit ORD-2')).toBeInTheDocument();
  });

  it('filters visible transactions by supplier name', () => {
    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'Old Supplier' },
    });

    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.queryByText('Edit ORD-2')).not.toBeInTheDocument();
  });

  it('filters visible transactions by product name', () => {
    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'Galaxy' },
    });

    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.queryByText('Edit ORD-2')).not.toBeInTheDocument();
  });

  it('switches between paid and missing-cost transaction tabs', () => {
    render(<TransactionsScreen />);

    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.getByText('Edit ORD-2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Missing costs tab'));

    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
    expect(screen.queryByText('Known Cost Accessory')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit ORD-2')).not.toBeInTheDocument();
  });

  it('links to reconciliation when visible transactions have unreviewed custom rows', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: [
        {
          createdAt: '2026-04-10T10:00:00.000Z',
          customerEmail: null,
          customerName: 'Olayinka',
          customerPhone: null,
          estimatedProfit: 0,
          id: 'order-unmatched',
          items: [
            {
              costPrice: null,
              costSource: null,
              imeiValues: ['353232106161443'],
              id: 'item-unmatched',
              name: 'iPhone 11 Pro 64gb Premium Used',
              productId: null,
              productMatchStatus: 'unreviewed',
              profit: null,
              quantity: 1,
              revenue: 180000,
              searchText: 'iphone 11 pro 64gb premium used 353232106161443',
              serialValues: [],
              sku: null,
              supplierName: '',
              variantId: null,
            },
            {
              costPrice: null,
              costSource: null,
              imeiValues: [],
              id: 'item-custom',
              name: 'Known custom service',
              productId: null,
              productMatchStatus: 'custom',
              profit: null,
              quantity: 1,
              revenue: 1000,
              searchText: 'known custom service',
              serialValues: [],
              sku: null,
              supplierName: '',
              variantId: null,
            },
          ],
          missingCostCount: 2,
          orderNumber: 'ORD-UNMATCHED',
          paymentMethod: 'transfer',
          searchText:
            'ord-unmatched olayinka iphone 11 pro 64gb premium used 353232106161443 known custom service',
          total: 181000,
        },
      ],
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<TransactionsScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Review 1 unmatched transaction item',
      })
    );

    expect(mocks.routerPush).toHaveBeenCalledWith(
      '/(admin)/transaction-reconciliation'
    );
  });

  it('hides the reconciliation entry point when only custom-kept rows remain', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: [
        {
          createdAt: '2026-04-10T10:00:00.000Z',
          customerEmail: null,
          customerName: 'Custom Customer',
          customerPhone: null,
          estimatedProfit: 0,
          id: 'order-custom',
          items: [
            {
              costPrice: null,
              costSource: null,
              imeiValues: [],
              id: 'item-custom',
              name: 'Known custom service',
              productId: null,
              productMatchStatus: 'custom',
              profit: null,
              quantity: 1,
              revenue: 1000,
              searchText: 'known custom service',
              serialValues: [],
              sku: null,
              supplierName: '',
              variantId: null,
            },
          ],
          missingCostCount: 1,
          orderNumber: 'ORD-CUSTOM',
          paymentMethod: 'transfer',
          searchText: 'ord-custom custom customer known custom service',
          total: 1000,
        },
      ],
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<TransactionsScreen />);

    expect(
      screen.queryByRole('button', {
        name: /Review .* unmatched transaction item/,
      })
    ).not.toBeInTheDocument();
  });

  it('does not match paid line items after switching to the missing-cost tab', () => {
    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Missing costs tab'));
    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'Known Supplier' },
    });

    expect(screen.queryByText('Edit ORD-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Known Cost Accessory')).not.toBeInTheDocument();
  });

  it('shows the async save error and keeps the editor actionable', async () => {
    const expectedTransactionDateIso = buildTransactionDateIso('2026-04-10');
    mocks.mutateAsync.mockRejectedValueOnce(new Error('save failed'));

    render(<TransactionsScreen />);

    fireEvent.click(screen.getByText('Edit ORD-1'));
    fireEvent.change(screen.getByLabelText('Cost price input'), {
      target: { value: '₦1,200' },
    });
    fireEvent.click(screen.getByText('Save cost price'));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        costPrice: 1200,
        orderId: 'order-1',
        orderItemId: 'item-1',
        productId: 'product-1',
        supplierName: 'Old supplier',
        transactionDateIso: expectedTransactionDateIso,
        updateProductDefault: false,
        variantId: null,
      })
    );

    expect(await screen.findByText('save failed')).toBeInTheDocument();
    expect(screen.getByText('Save cost price')).toBeInTheDocument();
  });
});

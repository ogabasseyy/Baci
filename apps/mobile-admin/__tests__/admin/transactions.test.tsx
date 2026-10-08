import '@testing-library/jest-dom/vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type React from 'react';
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

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    AppState: { addEventListener: mocks.appStateListener },
    StatusBar: () => null,
    ActivityIndicator: () =>
      React.createElement('div', { role: 'progressbar' }),
    Alert: {
      alert: mocks.alert,
    },
    Pressable: ({
      accessibilityLabel,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          disabled,
          onClick: () => onPress?.(),
        },
        children
      ),
    ScrollView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      hairlineWidth: 1,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      accessibilityLabel,
      onChangeText,
      placeholder,
      value,
    }: {
      accessibilityLabel?: string;
      onChangeText?: (value: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel ?? placeholder,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        placeholder,
        value: value ?? '',
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

vi.mock('expo-router', async () => {
  const React = await import('react');

  return {
    Stack: {
      Screen: () => React.createElement('div'),
    },
    useLocalSearchParams: mocks.useLocalSearchParams,
    useRouter: () => ({
      push: mocks.routerPush,
    }),
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      border: '#ddd',
      card: '#fff',
      error: '#f00',
      primary: '#2563eb',
      text: '#111',
      textMuted: '#666',
      textOnPrimary: '#fff',
      textSecondary: '#555',
      warning: '#d97706',
    },
    isDark: false,
  }),
}));

vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (amount: number) => `₦${amount.toLocaleString('en-US')}`,
    symbol: '₦',
  }),
}));

vi.mock('@/hooks/useAnalyticsOverview', () => ({
  useAnalyticsOverview: mocks.useAnalyticsOverview,
}));

vi.mock('@/hooks/useTransactionReview', () => ({
  useTransactionReview: mocks.useTransactionReview,
}));

vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: mocks.useDebounce,
}));

vi.mock('@/hooks/useMonthlyTransactionCount', () => ({
  useMonthlyTransactionCount: mocks.useMonthlyTransactionCount,
}));

vi.mock('@/hooks/useUpdateTransactionCostPrice', () => ({
  useUpdateTransactionCostPrice: mocks.useUpdateTransactionCostPrice,
}));

vi.mock('@/lib/search-transaction-review-orders', () => ({
  TRANSACTION_REVIEW_SEARCH_LIMIT: 100,
}));

function Text({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

vi.mock('@/components/transactions/TransactionsSummary', () => ({
  TransactionsSummary: ({
    activeTab,
    estimatedProfitLabel,
    onTabChange,
    summary,
  }: {
    activeTab?: 'paid' | 'missing-costs';
    estimatedProfitLabel: string;
    onTabChange?: (tab: 'paid' | 'missing-costs') => void;
    summary: { missingCosts: number; transactions: number };
  }) => (
    <div>
      <button
        aria-pressed={activeTab === 'paid'}
        type="button"
        onClick={() => onTabChange?.('paid')}
      >
        <Text>Paid transactions tab</Text>
      </button>
      <button
        aria-pressed={activeTab === 'missing-costs'}
        type="button"
        onClick={() => onTabChange?.('missing-costs')}
      >
        <Text>Missing costs tab</Text>
      </button>
      <Text>{estimatedProfitLabel}</Text>
      <Text>{`${summary.transactions} transactions`}</Text>
      <Text>{`${summary.missingCosts} missing costs`}</Text>
    </div>
  ),
}));

vi.mock('@/components/transactions/TransactionOrderCard', () => ({
  TransactionOrderCard: ({
    onOpenEditor,
    order,
  }: {
    onOpenEditor: (
      order: {
        createdAt: string;
        id: string;
      },
      item: {
        costPrice: number | null;
        id: string;
        name: string;
        productId: string | null;
        supplierName: string;
        variantId: string | null;
      }
    ) => void;
    order: {
      createdAt: string;
      id: string;
      items: Array<{
        costPrice: number | null;
        id: string;
        name: string;
        productId: string | null;
        supplierName: string;
        variantId: string | null;
      }>;
      orderNumber: string;
    };
  }) => (
    <div>
      <button type="button" onClick={() => onOpenEditor(order, order.items[0])}>
        <Text>{`Edit ${order.orderNumber}`}</Text>
      </button>
      {order.items.map((item) => (
        <Text key={item.id}>{item.name}</Text>
      ))}
    </div>
  ),
}));

vi.mock('@/components/transactions/CostPriceEditorModal', () => ({
  CostPriceEditorModal: ({
    costPriceInput,
    dateInput,
    onChangeCostPrice,
    onChangeDate,
    onChangeSupplier,
    onClose,
    onSave,
    saveError,
    supplierInput,
    visible,
  }: {
    costPriceInput: string;
    dateInput?: string;
    onChangeCostPrice: (value: string) => void;
    onChangeDate?: (value: string) => void;
    onChangeSupplier?: (value: string) => void;
    onClose: () => void;
    onSave: () => void;
    saveError: string | null;
    supplierInput?: string;
    visible: boolean;
  }) =>
    visible ? (
      <div>
        <input
          aria-label="Cost price input"
          value={costPriceInput}
          onChange={(event) => onChangeCostPrice(event.target.value)}
        />
        <input
          aria-label="Transaction date input"
          value={dateInput ?? ''}
          onChange={(event) => onChangeDate?.(event.target.value)}
        />
        <input
          aria-label="Vendor or supplier input"
          value={supplierInput ?? ''}
          onChange={(event) => onChangeSupplier?.(event.target.value)}
        />
        {saveError ? <Text>{saveError}</Text> : null}
        <button type="button" onClick={onSave}>
          <Text>Save cost price</Text>
        </button>
        <button type="button" onClick={onClose}>
          <Text>Close editor</Text>
        </button>
      </div>
    ) : null,
}));

import TransactionsScreen from '@/app/(admin)/transactions';
import { buildTransactionDateIso } from '@/lib/transaction-review';

const sampleOrders = [
  {
    createdAt: '2026-04-10T10:00:00.000Z',
    customerEmail: null,
    customerName: 'Bassey',
    customerPhone: null,
    estimatedProfit: 3000,
    id: 'order-1',
    items: [
      {
        costPrice: null,
        costSource: null,
        imeiValues: ['353232106161443'],
        id: 'item-1',
        name: 'Samsung Galaxy S26',
        productId: 'product-1',
        profit: null,
        quantity: 1,
        revenue: 5000,
        searchText:
          'samsung galaxy s26 bassey 353232106161443 sn-123 old supplier',
        serialValues: ['SN-123'],
        sku: 'SG-S26',
        supplierName: 'Old Supplier',
        variantId: null,
      },
      {
        costPrice: 4000,
        costSource: 'product' as const,
        imeiValues: [],
        id: 'item-known',
        name: 'Known Cost Accessory',
        productId: 'product-known',
        profit: 1000,
        quantity: 1,
        revenue: 5000,
        searchText: 'known cost accessory',
        serialValues: [],
        sku: 'KNOWN',
        supplierName: 'Known Supplier',
        variantId: null,
      },
    ],
    missingCostCount: 1,
    orderNumber: 'ORD-1',
    paymentMethod: 'card',
    searchText:
      'ord-1 bassey samsung galaxy s26 353232106161443 sn-123 old supplier known cost accessory known supplier',
    total: 5000,
  },
  {
    createdAt: '2026-04-09T10:00:00.000Z',
    customerEmail: null,
    customerName: 'Efosa',
    customerPhone: null,
    estimatedProfit: 1000,
    id: 'order-2',
    items: [
      {
        costPrice: 2000,
        costSource: 'product' as const,
        imeiValues: [],
        id: 'item-2',
        name: 'Itel Buds Neo 3',
        productId: 'product-2',
        profit: 1000,
        quantity: 1,
        revenue: 3000,
        searchText: 'itel buds neo 3 efosa',
        serialValues: [],
        sku: null,
        supplierName: '',
        variantId: null,
      },
    ],
    missingCostCount: 0,
    orderNumber: 'ORD-2',
    paymentMethod: 'transfer',
    searchText: 'ord-2 efosa itel buds neo 3',
    total: 3000,
  },
];

describe('TransactionsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useLocalSearchParams.mockReturnValue({});
    mocks.appStateListener.mockReturnValue({ remove: vi.fn() });
    mocks.mutateAsync.mockResolvedValue(undefined);
    mocks.useAnalyticsOverview.mockReturnValue({
      data: {
        summary: {
          profit: { value: 1250 },
        },
      },
    });
    mocks.useDebounce.mockImplementation((value) => value);
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: 2,
      error: null,
      refetch: vi.fn(),
    });
    mocks.useTransactionReview.mockReturnValue({
      data: sampleOrders,
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    });
    mocks.useUpdateTransactionCostPrice.mockReturnValue({
      isPending: false,
      mutateAsync: mocks.mutateAsync,
    });
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
    mocks.useTransactionReview.mockReturnValue({
      data: [],
      error: new Error('boom'),
      isLoading: false,
      isRefetching: false,
      refetch,
    });
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
        'Showing the first 100 matches. Refine your search to narrow results.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Edit ORD-1')).toBeInTheDocument();
  });

  it('disables the range query while searching', () => {
    render(<TransactionsScreen />);

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: '353232106161443' },
    });

    expect(mocks.useTransactionReview).toHaveBeenCalledWith(undefined, {
      enabled: false,
    });
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

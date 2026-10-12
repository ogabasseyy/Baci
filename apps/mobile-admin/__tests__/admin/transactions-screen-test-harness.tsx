import React from 'react';
import type { Mock } from 'vitest';
import { vi } from 'vitest';

/** Shared mocks, fixtures, and default wiring for TransactionsScreen suites. */
export function createTransactionsScreenHarness(mocks: {
  alert: Mock;
  appStateListener: Mock;
  mutateAsync: Mock;
  routerPush: Mock;
  useAnalyticsOverview: Mock;
  useDebounce: Mock;
  useLocalSearchParams: Mock;
  useMonthlyTransactionCount: Mock;
  useTransactionReview: Mock;
  useUpdateTransactionCostPrice: Mock;
}) {
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

  function wireDefaults() {
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
  }

  const modules = {
    reactNative: {
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
            type: 'button',
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
    },
    safeArea: {
      SafeAreaView: ({ children }: { children?: React.ReactNode }) => children,
    },
    ionicons: {
      Ionicons: () => null,
      default: () => null,
      __esModule: true,
    },
    expoRouter: {
      Stack: {
        Screen: () => React.createElement('div'),
      },
      useLocalSearchParams: mocks.useLocalSearchParams,
      useRouter: () => ({
        push: mocks.routerPush,
      }),
    },
    theme: {
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
    },
    currency: {
      useCurrency: () => ({
        format: (amount: number) => `₦${amount.toLocaleString('en-US')}`,
        symbol: '₦',
      }),
    },
    analyticsOverview: {
      useAnalyticsOverview: mocks.useAnalyticsOverview,
    },
    transactionReview: {
      useTransactionReview: mocks.useTransactionReview,
    },
    debounce: {
      useDebounce: mocks.useDebounce,
    },
    monthlyCount: {
      useMonthlyTransactionCount: mocks.useMonthlyTransactionCount,
    },
    costPrice: {
      useUpdateTransactionCostPrice: mocks.useUpdateTransactionCostPrice,
    },
    searchLimit: {
      TRANSACTION_REVIEW_SEARCH_LIMIT: 100,
    },
  };

  return { modules, sampleOrders, wireDefaults };
}

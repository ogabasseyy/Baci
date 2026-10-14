import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import type {
  TransactionReviewItem,
  TransactionReviewOrder,
} from '@/hooks/useTransactionReview';
import { TransactionOrderCardItem } from './TransactionOrderCardItem';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  setStringAsync: vi.fn(),
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: mocks.setStringAsync,
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,

  default: ({ name }: { name: string }) => <span>{name}</span>,
  __esModule: true,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    Alert: { alert: mocks.alert },
    StatusBar: () => null,
    Pressable: ({
      children,
      onPress,
    }: {
      children?: React.ReactNode;
      onPress?: (event?: { stopPropagation?: () => void }) => void;
    }) =>
      React.createElement(
        'button',
        { onClick: (event) => onPress?.(event), type: 'button' },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

describe('TransactionOrderCardItem', () => {
  const colors = {
    border: '#e2e8f0',
    error: '#dc2626',
    text: '#0f172a',
    textMuted: '#94a3b8',
    textSecondary: '#64748b',
  } as ThemeColors;

  const item: TransactionReviewItem = {
    costPrice: 200000,
    costSource: 'product',
    id: 'item-1',
    imeiValues: [],
    name: 'iPhone 15 Pro',
    offerId: '55555555-5555-4555-8555-555555555555',
    productId: 'product-1234567890',
    profit: 50000,
    quantity: 2,
    revenue: 500000,
    searchText: 'iphone',
    serialValues: [],
    sku: null,
    supplierName: 'Acme',
    variantId: null,
  };

  const order: TransactionReviewOrder = {
    createdAt: '2026-10-01T00:00:00.000Z',
    customerEmail: null,
    customerName: 'Ada',
    customerPhone: null,
    estimatedProfit: 50000,
    id: 'order-1',
    items: [item],
    missingCostCount: 0,
    orderNumber: 'ORD-1',
    paymentMethod: 'card',
    searchText: 'ord-1',
    total: 500000,
  };

  function renderItem(onOpenEditor = vi.fn()) {
    render(
      <TransactionOrderCardItem
        colors={colors}
        formatCurrency={(amount) => `₦${amount.toLocaleString('en-NG')}`}
        item={item}
        onOpenEditor={onOpenEditor}
        order={order}
      />
    );
    return onOpenEditor;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setStringAsync.mockResolvedValue(undefined);
  });

  it('copies the full offer reference on press', async () => {
    renderItem();

    fireEvent.click(screen.getByText('Offer 55555555'));

    await vi.waitFor(() => {
      expect(mocks.setStringAsync).toHaveBeenCalledWith(
        '55555555-5555-4555-8555-555555555555'
      );
    });
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('alerts instead of failing silent when the clipboard write rejects', async () => {
    mocks.setStringAsync.mockRejectedValueOnce(new Error('denied'));
    renderItem();

    fireEvent.click(screen.getByText('Offer 55555555'));

    await vi.waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith(
        'Copy failed',
        expect.stringContaining('Could not copy')
      );
    });
  });

  it('does not open the editor when the sibling copy control is pressed', async () => {
    const onOpenEditor = renderItem();

    fireEvent.click(screen.getByText('Offer 55555555'));

    await vi.waitFor(() => {
      expect(mocks.setStringAsync).toHaveBeenCalledWith(
        '55555555-5555-4555-8555-555555555555'
      );
    });
    // The copy control is a sibling of the row pressable (not nested),
    // so the copy press must never double-trigger the editor — on web
    // targets where presses bubble or on native.
    expect(onOpenEditor).not.toHaveBeenCalled();
  });
});

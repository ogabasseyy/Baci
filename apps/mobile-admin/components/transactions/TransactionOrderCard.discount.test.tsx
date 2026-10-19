import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { TransactionOrderCard } from './TransactionOrderCard';

vi.mock('react-native', async () => {
  const React = await import('react');
  const { getReactNativeDomStyle } = await import(
    '@/test/mocks/react-native-dom-style'
  );

  return {
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      accessibilityState?: { expanded?: boolean };
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          'aria-expanded': accessibilityState?.expanded,
          disabled,
          role: accessibilityRole,
          onClick: () => onPress?.(),
        },
        children
      ),
    Text: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) =>
      React.createElement(
        'span',
        { style: getReactNativeDomStyle(style) },
        children
      ),
    View: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) =>
      React.createElement(
        'div',
        { style: getReactNativeDomStyle(style) },
        children
      ),
  };
});

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');

  return {
    Ionicons: ({ name }: { name: string }) =>
      React.createElement('span', null, name),
    default: ({ name }: { name: string }) =>
      React.createElement('span', null, name),
    __esModule: true,
  };
});

vi.mock('@/components/transactions/transactions.styles', () => ({
  styles: {},
}));

const discountItem = {
  costPrice: 1200,
  costSource: 'product' as const,
  imeiValues: [],
  id: 'item-1',
  name: 'Samsung Galaxy S26',
  productId: 'product-1',
  profit: 3400,
  quantity: 1,
  revenue: 4600,
  searchText: 'samsung galaxy s26',
  serialValues: [],
  sku: 'SG-S26',
  supplierName: 'Slot Wholesale',
  variantId: null,
};

function renderDiscountOrder(discountAmount: number) {
  render(
    <TransactionOrderCard
      colors={LIGHT_COLORS}
      formatCurrency={(amount) => `NGN ${amount}`}
      onOpenEditor={vi.fn()}
      order={{
        createdAt: '2026-04-11T09:00:00.000Z',
        customerEmail: null,
        customerName: 'Bassey',
        customerPhone: null,
        discountAmount,
        estimatedProfit: 3400,
        id: 'order-1',
        items: [discountItem],
        missingCostCount: 0,
        orderNumber: 'ORD-1',
        paymentMethod: 'card',
        searchText: 'ord-1 bassey samsung galaxy s26',
        total: discountAmount > 0 ? 4100 : 4600,
      }}
    />
  );

  fireEvent.click(
    screen.getByRole('button', { name: /view order details for bassey/i })
  );
}

describe('TransactionOrderCard discount details', () => {
  it('shows the persisted order discount in expanded transaction details', () => {
    renderDiscountOrder(500);

    expect(screen.getByText('Discount -NGN 500')).toBeInTheDocument();
  });

  it('does not render a discount badge when the order discount is zero', () => {
    renderDiscountOrder(0);

    expect(screen.queryByText(/Discount -/)).not.toBeInTheDocument();
  });
});

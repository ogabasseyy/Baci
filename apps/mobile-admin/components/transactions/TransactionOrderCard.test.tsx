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

const editableItem = {
  costPrice: 1200,
  costSource: 'product' as const,
  imeiValues: ['353232106161443'],
  id: 'item-1',
  name: 'Samsung Galaxy S26',
  productId: 'product-1',
  profit: 3400,
  quantity: 1,
  revenue: 4600,
  searchText: 'samsung galaxy s26 slot wholesale',
  serialValues: ['SN-ABC-1'],
  sku: 'SG-S26',
  supplierName: 'Slot Wholesale',
  variantId: null,
};

const customItem = {
  costPrice: null,
  costSource: null,
  imeiValues: [],
  id: 'item-2',
  name: 'Manual adjustment',
  productId: null,
  profit: null,
  quantity: 1,
  revenue: 500,
  searchText: 'manual adjustment',
  serialValues: [],
  sku: null,
  supplierName: '',
  variantId: null,
};

describe('TransactionOrderCard', () => {
  it('reveals order details from the compact transaction card and closes them', () => {
    render(
      <TransactionOrderCard
        colors={LIGHT_COLORS}
        formatCurrency={(amount) => `NGN ${amount}`}
        onOpenEditor={vi.fn()}
        order={{
          createdAt: '2026-04-11T09:00:00.000Z',
          customerEmail: 'bassey@example.com',
          customerName: 'Bassey',
          customerPhone: '08030000000',
          estimatedProfit: 3400,
          id: 'order-1',
          items: [editableItem, customItem],
          missingCostCount: 0,
          orderNumber: 'ORD-1',
          paymentMethod: 'card',
          searchText: 'ord-1 bassey samsung galaxy s26',
          total: 4600,
        }}
      />
    );

    expect(screen.getByText('Bassey')).toBeInTheDocument();
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    expect(
      screen.queryByText('Supplier Slot wholesale')
    ).not.toBeInTheDocument();
    expect(screen.getByText('chevron-down')).toBeInTheDocument();

    const viewDetailsButton = screen.getByRole('button', {
      name: /view order details for bassey/i,
    });
    expect(viewDetailsButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(viewDetailsButton);

    expect(screen.getByText('Supplier Slot wholesale')).toBeInTheDocument();
    expect(screen.getByText('Total profit')).toBeInTheDocument();
    expect(screen.getByText('NGN 3400')).toHaveStyle({
      color: LIGHT_COLORS.success,
    });
    expect(screen.getByText('08030000000')).toBeInTheDocument();
    expect(screen.getByText('bassey@example.com')).toBeInTheDocument();
    expect(screen.getByText('close')).toBeInTheDocument();

    const closeDetailsButton = screen.getByRole('button', {
      name: /close order details for bassey/i,
    });
    expect(closeDetailsButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(closeDetailsButton);

    expect(
      screen.queryByText('Supplier Slot wholesale')
    ).not.toBeInTheDocument();
    expect(screen.getByText('chevron-down')).toBeInTheDocument();
  });

  it('opens the editor for editable product-linked rows', () => {
    const onOpenEditor = vi.fn();
    const order = {
      createdAt: '2026-04-11T09:00:00.000Z',
      customerEmail: null,
      customerName: 'Bassey',
      customerPhone: null,
      estimatedProfit: 3400,
      id: 'order-1',
      items: [editableItem],
      missingCostCount: 0,
      orderNumber: 'ORD-1',
      paymentMethod: 'card',
      searchText: 'ord-1 bassey samsung galaxy s26',
      total: 4600,
    };

    render(
      <TransactionOrderCard
        colors={LIGHT_COLORS}
        formatCurrency={(amount) => `NGN ${amount}`}
        onOpenEditor={onOpenEditor}
        order={order}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /view order details for bassey/i })
    );

    const row = screen.getByRole('button', {
      name: /Samsung Galaxy S26, 1 units, revenue NGN 4600/i,
    });

    expect(screen.getByText('create-outline')).toBeInTheDocument();
    expect(screen.getByText('Supplier Slot wholesale')).toBeInTheDocument();
    expect(screen.getByText('IMEI 353232106161443')).toBeInTheDocument();
    expect(screen.getByText('S/N SN-ABC-1')).toBeInTheDocument();

    fireEvent.click(row);
    expect(onOpenEditor).toHaveBeenCalledWith(order, editableItem);
  });

  it('opens the editor for unlinked custom rows so transaction cost can be fixed', () => {
    const onOpenEditor = vi.fn();
    const order = {
      createdAt: '2026-04-11T09:00:00.000Z',
      customerEmail: null,
      customerName: 'Bassey',
      customerPhone: null,
      estimatedProfit: 0,
      id: 'order-1',
      items: [customItem],
      missingCostCount: 1,
      orderNumber: 'ORD-1',
      paymentMethod: 'card',
      searchText: 'ord-1 bassey manual adjustment',
      total: 500,
    };

    render(
      <TransactionOrderCard
        colors={LIGHT_COLORS}
        formatCurrency={(amount) => `NGN ${amount}`}
        onOpenEditor={onOpenEditor}
        order={order}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /view order details for bassey/i })
    );

    const row = screen.getByRole('button', {
      name: /Manual adjustment, 1 units, revenue NGN 500/i,
    });

    expect(row).not.toBeDisabled();
    fireEvent.click(row);
    expect(onOpenEditor).toHaveBeenCalledWith(order, customItem);
  });

  it('labels recorded losses in red instead of showing negative profit', () => {
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
          estimatedProfit: -500,
          id: 'order-1',
          items: [
            {
              ...editableItem,
              costPrice: 2000,
              profit: -500,
              revenue: 1500,
            },
          ],
          missingCostCount: 0,
          orderNumber: 'ORD-1',
          paymentMethod: 'card',
          searchText: 'ord-1 bassey samsung galaxy s26',
          total: 1500,
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /view order details for bassey/i })
    );

    expect(screen.getByText('Loss NGN 500')).toHaveStyle({
      color: LIGHT_COLORS.error,
    });
    expect(screen.queryByText('Profit NGN -500')).not.toBeInTheDocument();
  });

  it('renders the stored condition and offer ref so offer lines stay distinguishable', () => {
    const offerItem = {
      ...editableItem,
      condition: 'refurbished',
      offerId: '55555555-5555-4555-8555-555555555555',
    };

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
          estimatedProfit: 3400,
          id: 'order-1',
          items: [offerItem],
          missingCostCount: 0,
          orderNumber: 'ORD-1',
          paymentMethod: 'card',
          searchText: 'ord-1 bassey',
          total: 4600,
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /view order details for bassey/i })
    );

    expect(screen.getByText(/Condition /)).toHaveTextContent(
      'Condition Open Box · Offer 55555555'
    );
  });

  it('omits the condition row when a line has neither condition nor offer', () => {
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
          estimatedProfit: 3400,
          id: 'order-1',
          items: [editableItem],
          missingCostCount: 0,
          orderNumber: 'ORD-1',
          paymentMethod: 'card',
          searchText: 'ord-1 bassey',
          total: 4600,
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /view order details for bassey/i })
    );

    expect(screen.queryByText(/Condition /)).not.toBeInTheDocument();
  });
});

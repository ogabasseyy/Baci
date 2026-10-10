import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { OrderDetailsItemsCard } from './OrderDetailsItemsCard';
import type { OrderDetailsItem } from './order-details.types';

const mocks = vi.hoisted(() => ({
  safeImage: vi.fn(),
}));

vi.mock('@/components/ui/SafeImage', async () => {
  const { Text } = await import('react-native');

  return {
    __esModule: true,
    default: (props: unknown) => {
      mocks.safeImage(props);
      return <Text>product-image</Text>;
    },
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,

  default: ({ name }: { name: string }) => <span>{name}</span>,
  __esModule: true,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Pressable: ({
      children,
      onPress,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        { onClick: () => onPress?.(), type: 'button' },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({
      children,
      numberOfLines: _numberOfLines,
    }: {
      children?: React.ReactNode;
      numberOfLines?: number;
    }) => React.createElement('span', null, children),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

describe('OrderDetailsItemsCard', () => {
  const colors = {
    backgroundLight: '#f8fafc',
    border: '#e2e8f0',
    card: '#ffffff',
    primary: '#2563eb',
    text: '#0f172a',
    textMuted: '#94a3b8',
    textSecondary: '#64748b',
  } as ThemeColors;

  const items: OrderDetailsItem[] = [
    {
      condition: 'open_box',
      id: 'item-1',
      image_url: 'https://example.com/phone.jpg',
      name: 'iPhone 15 Pro',
      price: 250000,
      product_id: 'product-1234567890',
      quantity: 2,
      variant_name: 'Black / 256GB',
    },
    {
      id: 'item-2',
      name: 'AirPods Pro',
      price: 95000,
      product_id: null,
      quantity: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the item summary, formatted condition, variant, sku, and price', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount.toLocaleString('en-NG')}`}
        items={items}
        onSelectItem={vi.fn()}
      />
    );

    expect(screen.getByText('Items (2)')).toBeInTheDocument();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('Condition: Open Box')).toBeInTheDocument();
    expect(screen.getByText('Black / 256GB')).toBeInTheDocument();
    expect(screen.getByText('SKU: product-...')).toBeInTheDocument();
    expect(screen.getByText('x2')).toBeInTheDocument();
    expect(screen.getByText('₦250,000')).toBeInTheDocument();
  });

  it('uses SafeImage when the item has an image and falls back to the placeholder icon otherwise', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount}`}
        items={items}
        onSelectItem={vi.fn()}
      />
    );

    expect(mocks.safeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { uri: 'https://example.com/phone.jpg' },
      })
    );
    expect(screen.getByText('image-outline')).toBeInTheDocument();
  });

  it('uses display-only product fallbacks without requiring persisted snapshots', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount}`}
        items={[
          {
            display_condition: 'used',
            display_image_url: 'https://example.com/catalog-phone.jpg',
            id: 'item-with-fallbacks',
            name: 'Legacy Phone',
            price: 120000,
            product_id: 'product-1',
            quantity: 1,
          },
        ]}
        onSelectItem={vi.fn()}
      />
    );

    expect(screen.getByText('Condition: Used')).toBeInTheDocument();
    expect(mocks.safeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { uri: 'https://example.com/catalog-phone.jpg' },
      })
    );
  });

  it('forwards the selected order item when a row is pressed', () => {
    const onSelectItem = vi.fn();

    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount}`}
        items={items}
        onSelectItem={onSelectItem}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /AirPods Pro/i }));

    expect(onSelectItem).toHaveBeenCalledWith(items[1]);
  });

  it('renders the selected offer grade, notes, and full ref', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount.toLocaleString('en-NG')}`}
        items={[
          {
            ...items[0],
            offer_id: '55555555-5555-4555-8555-555555555555',
            offer_grade: 'B',
            offer_condition_notes: 'Light wear',
          },
        ]}
        onSelectItem={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Offer: Grade B · Light wear · ref 55555555-5555-4555-8555-555555555555'
      )
    ).toBeInTheDocument();
  });

  it('renders snapshot labels without a ref when the offer was deleted', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount.toLocaleString('en-NG')}`}
        items={[
          {
            ...items[0],
            offer_id: undefined,
            offer_grade: 'A',
            offer_condition_notes: 'Mint',
            offer_labels_snapshotted: true,
          },
        ]}
        onSelectItem={vi.fn()}
      />
    );

    expect(screen.getByText('Offer: Grade A · Mint')).toBeInTheDocument();
  });

  it('renders only the full ref when the offer labels are unresolved', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount.toLocaleString('en-NG')}`}
        items={[
          {
            ...items[0],
            offer_id: '55555555-5555-4555-8555-555555555555',
          },
        ]}
        onSelectItem={vi.fn()}
      />
    );

    expect(
      screen.getByText('Offer: ref 55555555-5555-4555-8555-555555555555')
    ).toBeInTheDocument();
  });
});

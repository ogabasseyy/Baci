import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { OrderDetailsItemsCard } from './OrderDetailsItemsCard';
import type { OrderDetailsItem } from './order-details.types';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  pressable: vi.fn(),
  safeImage: vi.fn(),
  setStringAsync: vi.fn(),
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: mocks.setStringAsync,
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
    Alert: { alert: mocks.alert },
    StatusBar: () => null,
    Pressable: (props: {
      accessibilityHint?: string;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      children?: React.ReactNode;
      hitSlop?: number;
      onPress?: (event?: { stopPropagation?: () => void }) => void;
    }) => {
      const { children, onPress, ...rest } = props;
      mocks.pressable(rest);
      return React.createElement(
        'button',
        {
          onClick: (event) => onPress?.(event),
          type: 'button',
          ...(props.accessibilityLabel
            ? { 'aria-label': props.accessibilityLabel }
            : {}),
        },
        children
      );
    },
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

  it('renders the selected offer grade, notes, and a truncated copyable ref', () => {
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

    expect(screen.getByText('Offer: Grade B · Light wear')).toBeInTheDocument();
    expect(screen.getByText('ref 55555555')).toBeInTheDocument();
    expect(
      screen.queryByText(/55555555-5555-4555-8555-555555555555/)
    ).not.toBeInTheDocument();
  });

  it('copies the full offer id when the truncated ref is pressed', async () => {
    const onSelectItem = vi.fn();
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
        onSelectItem={onSelectItem}
      />
    );

    fireEvent.click(screen.getByText('ref 55555555'));

    await vi.waitFor(() => {
      expect(mocks.setStringAsync).toHaveBeenCalledWith(
        '55555555-5555-4555-8555-555555555555'
      );
    });
    // The copy press must not bubble to the row select on web targets.
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it('alerts instead of failing silent when the clipboard write rejects', async () => {
    mocks.setStringAsync.mockRejectedValueOnce(new Error('denied'));
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount}`}
        items={[
          {
            ...items[0],
            offer_id: '55555555-5555-4555-8555-555555555555',
          },
        ]}
        onSelectItem={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('ref 55555555'));

    await vi.waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith(
        'Copy failed',
        expect.stringContaining('Could not copy')
      );
    });
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

  it('falls back to the immutable snapshot ref when the live offer was deleted', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount.toLocaleString('en-NG')}`}
        items={[
          {
            ...items[0],
            offer_id: undefined,
            offer_id_snapshot: '66666666-6666-4666-8666-666666666666',
            offer_grade: 'A',
            offer_condition_notes: 'Mint',
            offer_labels_snapshotted: true,
          },
        ]}
        onSelectItem={vi.fn()}
      />
    );

    expect(screen.getByText('Offer: Grade A · Mint')).toBeInTheDocument();
    expect(
      screen.getByText('ref 66666666 (deleted offer)')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Copy full offer reference 66666666-6666-4666-8666-666666666666',
      })
    ).toBeInTheDocument();
  });

  it('renders only the truncated ref when the offer labels are unresolved', () => {
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

    expect(screen.queryByText(/Offer:/)).not.toBeInTheDocument();
    expect(screen.getByText('ref 55555555')).toBeInTheDocument();
  });

  it('exposes row semantics and an expanded copy target', () => {
    render(
      <OrderDetailsItemsCard
        colors={colors}
        formatPrice={(amount) => `₦${amount}`}
        items={[
          {
            ...items[0],
            offer_id: '55555555-5555-4555-8555-555555555555',
          },
        ]}
        onSelectItem={vi.fn()}
      />
    );

    // The row select keeps button semantics with a label and hint.
    expect(
      screen.getByRole('button', { name: 'iPhone 15 Pro, quantity 2' })
    ).toBeInTheDocument();
    expect(mocks.pressable).toHaveBeenCalledWith(
      expect.objectContaining({
        accessibilityRole: 'button',
        accessibilityLabel: 'iPhone 15 Pro, quantity 2',
        accessibilityHint: 'Opens the details for this item',
      })
    );
    // The 12px copy control expands its touch area via hitSlop.
    expect(mocks.pressable).toHaveBeenCalledWith(
      expect.objectContaining({
        accessibilityLabel:
          'Copy full offer reference 55555555-5555-4555-8555-555555555555',
        hitSlop: 12,
      })
    );
  });
});

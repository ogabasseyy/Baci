import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import {
  OrderItemDetailModal,
  type OrderItemSnapshot,
} from './OrderItemDetailModal';

vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({
    accessibilityLabel,
    children,
    sheetStyle,
    visible,
  }: {
    accessibilityLabel: string;
    children?: ReactNode;
    sheetStyle?: unknown;
    visible: boolean;
  }) =>
    visible ? (
      <section
        aria-label={accessibilityLabel}
        data-sheet-style={JSON.stringify(sheetStyle)}
      >
        {children}
      </section>
    ) : null,
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { color?: string; name: string; size?: number }) => name,

  default: ({ name }: { color?: string; name: string; size?: number }) => name,
  __esModule: true,
}));

vi.mock('@/components/ui/SafeImage', () => ({
  default: ({ source }: { source?: { uri?: string } }) => source?.uri ?? null,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: LIGHT_COLORS,
  }),
}));

vi.mock('react-native', () => {
  return {
    StatusBar: () => null,
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: ReactNode;
      onPress?: () => void;
    }) => (
      <button aria-label={accessibilityLabel} onClick={onPress} type="button">
        {children}
      </button>
    ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
    },
    Text: ({ children, style }: { children?: ReactNode; style?: unknown }) => (
      <span data-style={JSON.stringify(style)}>{children}</span>
    ),
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

function createItem(
  overrides: Partial<OrderItemSnapshot> = {}
): OrderItemSnapshot {
  return {
    id: 'item-1',
    condition: 'open_box',
    image_url: 'https://example.com/s22.png',
    name: 'Samsung Galaxy S22 Ultra',
    price: 500000,
    product_id: '1e3a022f-608c-45c4-8afa-b29e6c673b8b',
    quantity: 1,
    variant_name: '128GB / Phantom Black',
    ...overrides,
  };
}

describe('OrderItemDetailModal', () => {
  it('renders the order snapshot details through the shared sheet shell', () => {
    render(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={createItem()}
        onClose={vi.fn()}
        visible
      />
    );

    expect(
      screen.getByRole('region', { name: 'Order item details' })
    ).toBeInTheDocument();
    expect(screen.getByText('Item Details')).toBeInTheDocument();
    expect(screen.getByText('Samsung Galaxy S22 Ultra')).toBeInTheDocument();
    expect(screen.getByText('128GB / Phantom Black')).toBeInTheDocument();
    expect(screen.getByText('Quantity')).toBeInTheDocument();
    expect(screen.getByText('Unit price')).toBeInTheDocument();
    expect(screen.getByText('Line total')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('Open Box')).toBeInTheDocument();
    expect(screen.queryByText('Edit Product')).not.toBeInTheDocument();
  });

  it('leaves the space under the sheet to the shared shell, not padding it twice', () => {
    render(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={createItem()}
        onClose={vi.fn()}
        visible
      />
    );

    // The shell already paints a safe-area strip under every attached sheet.
    expect(
      screen
        .getByRole('region', { name: 'Order item details' })
        .getAttribute('data-sheet-style')
    ).not.toContain('paddingBottom');
  });

  it('closes when the user presses the close control', () => {
    const onClose = vi.fn();

    render(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={createItem()}
        onClose={onClose}
        visible
      />
    );

    fireEvent.click(screen.getByLabelText('Close item details'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the theme text-on-primary token for the done button label', () => {
    render(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={createItem()}
        onClose={vi.fn()}
        visible
      />
    );

    expect(screen.getByText('Done')).toHaveAttribute(
      'data-style',
      expect.stringContaining(LIGHT_COLORS.textOnPrimary)
    );
  });

  it('uses display-only item fallbacks when persisted snapshot fields are empty', () => {
    render(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={createItem({
          condition: undefined,
          display_condition: 'used',
          display_image_url: 'https://example.com/catalog-s22.png',
          image_url: undefined,
        })}
        onClose={vi.fn()}
        visible
      />
    );

    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(
      screen.getByText('https://example.com/catalog-s22.png')
    ).toBeInTheDocument();
  });

  it('exposes accessible button controls for both dismissal actions', () => {
    render(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={createItem()}
        onClose={vi.fn()}
        visible
      />
    );

    expect(
      screen.getByRole('button', { name: 'Close item details' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close item detail sheet' })
    ).toBeInTheDocument();
  });

  it('does not render when hidden or when no item is available', () => {
    const { rerender } = render(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={createItem()}
        onClose={vi.fn()}
        visible={false}
      />
    );

    expect(
      screen.queryByRole('region', { name: 'Order item details' })
    ).not.toBeInTheDocument();

    rerender(
      <OrderItemDetailModal
        formattedLineTotal="₦500,000"
        formattedUnitPrice="₦500,000"
        item={null}
        onClose={vi.fn()}
        visible={true}
      />
    );

    expect(
      screen.queryByRole('region', { name: 'Order item details' })
    ).not.toBeInTheDocument();
  });
});

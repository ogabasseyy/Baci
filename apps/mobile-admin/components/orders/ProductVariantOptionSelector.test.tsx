import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';
import { buildVariantOptionGroups } from '@/lib/product-variant-option-selector';
import { ProductVariantOptionSelector } from './ProductVariantOptionSelector';

vi.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetScrollView: ({
    children,
    contentContainerStyle,
    testID,
  }: {
    children?: ReactNode;
    contentContainerStyle?: unknown;
    testID?: string;
  }) => (
    <div
      data-has-content-container-style={Boolean(contentContainerStyle)}
      data-testid={testID}
    >
      {children}
    </div>
  ),
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    Pressable: ({
      accessibilityLabel,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityState?: { disabled?: boolean; selected?: boolean };
      children?: ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-disabled': disabled || accessibilityState?.disabled,
          'aria-label': accessibilityLabel,
          'aria-pressed': accessibilityState?.selected,
          disabled,
          onClick: onPress,
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

const colors = {
  backgroundLight: '#f8fafc',
  border: '#e2e8f0',
  card: '#ffffff',
  error: '#dc2626',
  primary: '#2563eb',
  text: '#0f172a',
  textMuted: '#94a3b8',
  textOnPrimary: '#ffffff',
  textSecondary: '#64748b',
};

function variant(
  id: string,
  attributes: Record<string, string>,
  overrides: Partial<AdminProductVariant> = {}
): AdminProductVariant {
  return {
    condition: 'used',
    cost_price: null,
    has_variants: false,
    id,
    images: [],
    name: `Alienware M16 R2 ${id}`,
    parent_product_id: 'product-1',
    price: 2_145_000,
    primary_image: null,
    sku: id.toUpperCase(),
    source: 'structured',
    stock_quantity: 0,
    variant_attributes: attributes,
    ...overrides,
  };
}

const parentProduct: Parameters<
  typeof ProductVariantOptionSelector
>[0]['parentProduct'] = {
  condition: 'used',
  has_variants: true,
  id: 'product-1',
  images: [],
  name: 'Alienware M16 R2',
  parent_product_id: null,
  price: 2_145_000,
  sku: null,
  variant_attributes: {
    condition: ['used', 'new'],
    gpu: ['RTX 4070'],
    processor: ['Intel Ultra 7 155H', 'Intel Ultra 9 185H'],
    ram: ['16GB', '32GB', '64GB'],
    storage: ['1TB'],
  },
};

const variants = [
  variant('used-16', {
    graphics: '8GB RTX 4070 Graphics',
    processor: 'Intel Ultra 7 155H',
    ram: '16GB RAM',
    storage: '1TB SSD',
  }),
  variant('used-32', {
    graphics: '8GB NVIDIA RTX 4070 Graphics',
    processor: 'Intel Ultra 9 185H',
    ram: '32GB RAM',
    storage: '1TB SSD',
  }),
  variant(
    'new-64',
    {
      camera: 'Webcam',
      graphics: '8GB NVIDIA GeForce RTX 4070 Graphics',
      keyboard: 'Backlit keyboard',
      model_number: 'DYMSR54',
      operating_system: 'Windows 11 Pro',
      processor: 'Intel Core Ultra 7 155H',
      ram: '64GB RAM',
      storage: '1TB SSD',
      wireless: 'WLAN and Bluetooth',
    },
    { condition: 'new', price: 4_330_000 }
  ),
];

function renderSelector(
  args: {
    onSelect?: (key: string, value: string) => void;
    selectedVariant?: AdminProductVariant | null;
  } = {}
) {
  return render(
    <ProductVariantOptionSelector
      colors={colors}
      formatPrice={(amount) => `N${amount}`}
      onSelect={args.onSelect ?? vi.fn()}
      parentProduct={parentProduct}
      selectedVariant={args.selectedVariant ?? null}
      variantOptionGroups={buildVariantOptionGroups(
        variants,
        {},
        {
          declaration: parentProduct.variant_attributes,
        }
      )}
    />
  );
}

describe('ProductVariantOptionSelector', () => {
  it('uses the bottom-sheet scroll view for selectable groups', () => {
    renderSelector();

    expect(screen.getByTestId('variant-option-scroll-view')).toHaveAttribute(
      'data-has-content-container-style',
      'true'
    );
  });

  it('shows only purchase choices and does not render fixed specifications', () => {
    renderSelector();

    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('Ram')).toBeInTheDocument();
    expect(screen.getByText('Processor')).toBeInTheDocument();
    expect(screen.queryByText('Camera')).not.toBeInTheDocument();
    expect(screen.queryByText('Keyboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Model number')).not.toBeInTheDocument();
    expect(screen.queryByText('Operating system')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage')).not.toBeInTheDocument();
    expect(screen.queryByText('Graphics')).not.toBeInTheDocument();
  });

  it('reports option presses without silently adding a variant', () => {
    const onSelect = vi.fn();
    renderSelector({ onSelect });

    fireEvent.click(screen.getByRole('button', { name: 'Select Ram 64GB' }));

    expect(onSelect).toHaveBeenCalledWith('ram', '64GB');
    expect(
      screen.queryByRole('button', { name: 'Add selected variant' })
    ).not.toBeInTheDocument();
  });

  it('shows the exact selected variant price', () => {
    renderSelector({ selectedVariant: variants[2] });

    expect(screen.getByText('N4330000')).toBeInTheDocument();
  });
});

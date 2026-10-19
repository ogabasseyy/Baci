import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { ProductDetailVariantSelectors } from './product-detail-variant-selectors';
import type { ProductCondition } from './product-selection-condition';

const product = {
  has_variants: true,
  stock: 10,
  stock_quantity: 10,
  manage_stock: true,
  variants: [
    {
      id: 'v-red',
      attributes: { color: 'red' },
      stock_quantity: 5,
    },
    {
      id: 'v-blue',
      attributes: { color: 'blue' },
      stock_quantity: 0,
    },
  ],
} as unknown as Product;

const base = {
  product,
  attributeOptions: [{ key: 'color', values: ['red', 'blue'] }],
  effectiveVariantAttributes: { color: 'red' },
  onAttributeChange: vi.fn(),
  isStockManaged: true,
  selectedCondition: 'new' as ProductCondition,
  usesVariantConditions: false,
};

describe('ProductDetailVariantSelectors', () => {
  it('renders nothing without variants', () => {
    const { container } = render(
      <ProductDetailVariantSelectors
        {...base}
        product={{ ...product, has_variants: false }}
        attributeOptions={[]}
      />
    );
    expect(container.textContent).toBe('');
  });

  it('selects an available option on click', () => {
    const onAttributeChange = vi.fn();
    render(
      <ProductDetailVariantSelectors
        {...base}
        onAttributeChange={onAttributeChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /red/ }));
    expect(onAttributeChange).toHaveBeenCalledWith('color', 'red');
  });

  it('disables options with no available units', () => {
    render(<ProductDetailVariantSelectors {...base} />);
    // Red (5 units) is selectable; blue (0 units) is disabled.
    expect(screen.getByRole('button', { name: /red/ })).toHaveProperty(
      'disabled',
      false
    );
    expect(screen.getByRole('button', { name: /blue/ })).toHaveProperty(
      'disabled',
      true
    );
  });
});

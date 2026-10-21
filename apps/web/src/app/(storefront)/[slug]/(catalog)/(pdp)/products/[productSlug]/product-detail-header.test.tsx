import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { ProductDetailHeader } from './product-detail-header';

const product = {
  name: 'Widget',
  sku: 'SKU-1',
  mpn: '',
  description: 'A fine widget.',
  fulfillmentFields: [{ name: 'Serial number' }],
} as Product;

describe('ProductDetailHeader', () => {
  it('renders name, sku, price, and description', () => {
    render(
      <ProductDetailHeader
        product={product}
        formatCurrency={(value) => `NGN${value}`}
        currentPrice={50000}
        currentCompareAtPrice={null}
      />
    );
    expect(screen.getByRole('heading', { name: 'Widget' })).toBeDefined();
    expect(screen.getByText('SKU: SKU-1')).toBeDefined();
    expect(screen.getByText('NGN50000')).toBeDefined();
    expect(screen.getByText('A fine widget.')).toBeDefined();
    expect(screen.getByText('Serial number')).toBeDefined();
  });

  it('shows the compare-at price only when it undercuts nothing', () => {
    const { rerender } = render(
      <ProductDetailHeader
        product={product}
        formatCurrency={(value) => `NGN${value}`}
        currentPrice={50000}
        currentCompareAtPrice={60000}
      />
    );
    expect(screen.getByText('NGN60000')).toBeDefined();

    rerender(
      <ProductDetailHeader
        product={product}
        formatCurrency={(value) => `NGN${value}`}
        currentPrice={50000}
        currentCompareAtPrice={40000}
      />
    );
    expect(screen.queryByText('NGN40000')).toBeNull();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { ProductDetailStockPanel } from './product-detail-stock-panel';

const product = {
  low_stock_threshold: 5,
  minimum_order_quantity: 1,
} as Product;

describe('ProductDetailStockPanel', () => {
  it('marks depleted managed stock out of stock', () => {
    render(
      <ProductDetailStockPanel
        product={product}
        isOutOfStock
        isStockManaged
        currentStock={0}
      />
    );
    expect(screen.getByText('Out of Stock')).toBeDefined();
  });

  it('flags low managed stock with a unit count', () => {
    render(
      <ProductDetailStockPanel
        product={product}
        isOutOfStock={false}
        isStockManaged
        currentStock={3}
      />
    );
    expect(screen.getByText('In Stock')).toBeDefined();
    expect(screen.getByText(/3 units available/)).toBeDefined();
    expect(screen.getByText(/Low Stock/)).toBeDefined();
  });

  it('reports unlimited stock without a unit count', () => {
    render(
      <ProductDetailStockPanel
        product={product}
        isOutOfStock={false}
        isStockManaged={false}
        currentStock={0}
      />
    );
    expect(screen.getByText('Unlimited stock')).toBeDefined();
    expect(screen.getByText('Unlimited stock available')).toBeDefined();
  });

  it('discloses a minimum order quantity above one', () => {
    render(
      <ProductDetailStockPanel
        product={{ ...product, minimum_order_quantity: 4 }}
        isOutOfStock={false}
        isStockManaged
        currentStock={10}
      />
    );
    expect(screen.getByText(/Minimum order quantity/)).toBeDefined();
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { ProductDetailBelowFold } from './product-detail-below-fold';

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

describe('ProductDetailBelowFold', () => {
  it('renders the below-fold sections for the product', () => {
    const { container } = render(
      <ProductDetailBelowFold
        product={{ id: 'p1', name: 'Widget' } as Product}
      />
    );
    // Dynamic sections are stubbed; the privacy wrapper must survive.
    expect(container.querySelector('[data-nosnippet]')).not.toBeNull();
  });
});

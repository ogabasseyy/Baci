import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { alt, fill: _fill, priority: _priority, ...imageProps } = props;

    return <img {...imageProps} alt={String(alt ?? '')} />;
  },
}));
// Product images now render through CdnFormatImage (explicit per-format
// <picture>). Its real pipeline calls next/image's `getImageProps`; surface it
// as a plain <img> so these tests keep asserting card behavior.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { alt, fill: _fill, preload: _preload, ...imageProps } = props;

    return <img {...imageProps} alt={String(alt ?? '')} />;
  },
}));
vi.mock('next/link', () => ({
  default: (
    props: { children: React.ReactNode; href: string } & Record<string, unknown>
  ) => {
    const { children, prefetch: _prefetch, ...anchorProps } = props;

    return <a {...anchorProps}>{children}</a>;
  },
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({ merchant: { id: 'm-1', slug: 'test' } })),
}));
vi.mock('@/lib/routes', () => ({ asRoute: vi.fn((p: string) => p) }));
vi.mock('@/lib/product-url', () => ({
  getProductUrl: vi.fn(() => '/test/product'),
}));
vi.mock('../providers/v2-comparison-context', () => ({
  useV2Comparison: vi.fn(() => ({
    comparisonIds: new Set(),
    isInCompare: vi.fn(() => false),
    toggleComparison: vi.fn(),
  })),
}));
vi.mock('../providers/v2-saved-context', () => ({
  useV2Saved: vi.fn(() => ({
    savedIds: new Set(),
    isSaved: vi.fn(() => false),
    toggleSaved: vi.fn(),
  })),
}));

import { ProductCard } from './ProductCard';

const mockProduct = {
  id: 'p-1',
  name: 'Test Product',
  price: '₦5,000',
  image: 'https://example.com/img.jpg',
  description: 'A test product',
  category: 'electronics',
  slug: 'test-product',
  rating: 4.5,
  reviewCount: 10,
  condition: 'New' as const,
};

describe('ProductCard quick add confirmation', () => {
  it('confirms a quick add on the card so the tap never looks ignored', () => {
    const { rerender } = render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Add Test Product to cart' })
    ).toBeInTheDocument();
    // One stable live region, empty until something is added.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText('Added to cart')).not.toBeInTheDocument();

    rerender(
      <ProductCard product={mockProduct} onAddToCart={vi.fn()} isAdded />
    );

    expect(
      screen.getByRole('button', { name: 'Add another Test Product to cart' })
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Test Product added to cart'
    );
    expect(screen.getByText('Added to cart')).toBeInTheDocument();
  });
});

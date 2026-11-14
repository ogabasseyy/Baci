import { render } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { alt, fill: _fill, priority: _priority, ...imageProps } = props;

    return <img {...imageProps} alt={String(alt ?? '')} />;
  },
}));
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

describe('ProductCard content-visibility reservations', () => {
  it('keeps its default content-visibility reservation when no override is passed', () => {
    const grid = render(
      <ProductCard product={mockProduct} onAddToCart={vi.fn()} isAdded={false} />
    );
    const gridCard = grid.container.firstChild as HTMLElement;
    expect(gridCard).toHaveClass('content-auto');
    expect(gridCard).toHaveClass('[contain-intrinsic-size:auto_350px]');

    const list = render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        viewMode="list"
      />
    );
    const listCard = list.container.firstChild as HTMLElement;
    expect(listCard).toHaveClass('content-auto');
    expect(listCard).toHaveClass('[contain-intrinsic-size:auto_200px]');
  });

  it('applies an explicit content-visibility override', () => {
    const { container } = render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        contentVisibilityClassName="content-auto [contain-intrinsic-size:auto_300px] md:[contain-intrinsic-size:auto_460px]"
      />
    );
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('[contain-intrinsic-size:auto_300px]');
    expect(card).toHaveClass('md:[contain-intrinsic-size:auto_460px]');
    expect(card).not.toHaveClass('[contain-intrinsic-size:auto_350px]');
  });

  it('omits content-visibility entirely when passed an empty override', () => {
    const { container } = render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        contentVisibilityClassName=""
      />
    );
    const card = container.firstChild as HTMLElement;
    expect(card).not.toHaveClass('content-auto');
    expect(card).not.toHaveClass('[contain-intrinsic-size:auto_350px]');
  });
});

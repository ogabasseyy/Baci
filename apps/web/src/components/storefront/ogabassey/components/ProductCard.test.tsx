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

describe('ProductCard', () => {
  it('renders product name', () => {
    render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
      />
    );
    expect(screen.getByText('Test Product')).toBeDefined();
  });

  it('uses explicit product image alt text in grid cards', () => {
    render(
      <ProductCard
        product={{
          ...mockProduct,
          seo_alt_text: 'Angled view of the test product',
        }}
        onAddToCart={vi.fn()}
        isAdded={false}
      />
    );

    expect(
      screen.getByRole('img', {
        name: 'Angled view of the test product',
      })
    ).toBeInTheDocument();
  });

  it('marks grid product photo canvases so transparent assets stay on a neutral dark-mode surface', () => {
    render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
      />
    );

    expect(
      screen.getByRole('img', { name: mockProduct.name }).parentElement
    ).toHaveClass('ogabassey-product-card-image-surface');
  });

  it('uses explicit product image alt text in list cards', () => {
    render(
      <ProductCard
        product={{
          ...mockProduct,
          image_alt: 'Side view of the test product',
        }}
        onAddToCart={vi.fn()}
        isAdded={false}
        viewMode="list"
      />
    );

    expect(
      screen.getByRole('img', {
        name: 'Side view of the test product',
      })
    ).toBeInTheDocument();
  });

  it('marks list product photo canvases so transparent assets stay on a neutral dark-mode surface', () => {
    render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        viewMode="list"
      />
    );

    expect(
      screen.getByRole('img', { name: mockProduct.name }).parentElement
    ).toHaveClass('ogabassey-product-card-image-surface');
  });

  it('marks the placeholder image as decorative when no product image is rendered', () => {
    const { container } = render(
      <ProductCard
        product={{
          ...mockProduct,
          image: '',
          image_alt: 'Actual product image alt',
          image_payloads: [
            {
              url: 'https://example.com/actual-product.jpg',
              alt: 'Actual product payload alt',
            },
          ],
        }}
        onAddToCart={vi.fn()}
        isAdded={false}
      />
    );

    const image = container.querySelector('img');

    expect(image).toHaveAttribute('src', expect.stringContaining('placeholder.svg'));
    expect(image).toHaveAttribute('alt', '');
  });

  it.each(['grid', 'list'] as const)(
    'shows the star rating in %s view when a product has real review data',
    (viewMode) => {
      render(
        <ProductCard
          product={mockProduct}
          onAddToCart={vi.fn()}
          isAdded={false}
          viewMode={viewMode}
        />
      );

      expect(screen.getByText('(4.5)')).toBeInTheDocument();
    }
  );

  it.each([
    { label: 'missing', rating: undefined },
    { label: 'zero', rating: 0 },
    { label: 'negative', rating: -2 },
    { label: 'NaN', rating: Number.NaN },
    { label: 'Infinity', rating: Number.POSITIVE_INFINITY },
  ])('hides the star rating in grid view for a $label rating', ({ rating }) => {
    render(
      <ProductCard
        product={{ ...mockProduct, rating }}
        onAddToCart={vi.fn()}
        isAdded={false}
      />
    );

    expect(screen.queryByText(/^\(/)).not.toBeInTheDocument();
  });

  it.each([
    { label: 'missing', rating: undefined },
    { label: 'zero', rating: 0 },
    { label: 'negative', rating: -2 },
    { label: 'NaN', rating: Number.NaN },
    { label: 'Infinity', rating: Number.POSITIVE_INFINITY },
  ])('hides the star rating in list view for a $label rating', ({ rating }) => {
    render(
      <ProductCard
        product={{ ...mockProduct, rating }}
        onAddToCart={vi.fn()}
        isAdded={false}
        viewMode="list"
      />
    );

    expect(screen.queryByText(/^\(/)).not.toBeInTheDocument();
  });

  it('renders with isAdded state', () => {
    const { container } = render(
      <ProductCard
        product={mockProduct}
        onAddToCart={vi.fn()}
        isAdded={true}
      />
    );
    expect(container).toBeDefined();
  });

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
    // The default reservation must not leak through when overridden.
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

  it('links SKU-matrix products to option selection instead of quick-adding', () => {
    const onAddToCart = vi.fn();

    render(
      <ProductCard
        product={
          {
            ...mockProduct,
            available_conditions: ['open_box', 'used'],
            has_variants: true,
            variant_model: 'sku_matrix',
          } as typeof mockProduct
        }
        onAddToCart={onAddToCart}
        isAdded={false}
      />
    );

    const chooseOptionsLink = screen.getByRole('link', {
      name: `Choose options for ${mockProduct.name}`,
    });

    expect(chooseOptionsLink).toHaveAttribute('href', '/test/product');
    expect(onAddToCart).not.toHaveBeenCalled();
  });
});

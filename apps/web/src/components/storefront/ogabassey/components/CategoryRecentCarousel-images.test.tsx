import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '' }),
}));
vi.mock('@/lib/seo-utils', () => ({
  getProductUrl: (product: { slug?: string }) => `/p/${product.slug}`,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));
// The category banner now renders through CdnFormatImage (explicit per-format
// <picture>); surface it as a plain <img> so the banner-fallback assertions keep
// reading the raw src, not the transformed per-format URL.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));
vi.mock('./AdUnit', () => ({
  AdUnit: ({ placementKey }: { placementKey: string }) => (
    <span data-placement={placementKey} data-testid="ad-unit" />
  ),
}));
vi.mock('./LaunchCarousel', () => ({
  LaunchCarousel: ({
    slides,
  }: {
    slides: Array<{
      kind: string;
      id: string;
      name?: string;
      href?: string;
      priceLabel?: string;
      imageUrl?: string;
      content?: React.ReactNode;
    }>;
  }) => (
    <div data-testid="launch-carousel">
      {slides.map((slide, index) =>
        slide.kind === 'ad' ? (
          <div data-index={index} data-testid="ad-slide" key={slide.id}>
            {slide.content}
          </div>
        ) : (
          <a
            data-image={slide.imageUrl}
            data-index={index}
            href={slide.href}
            key={slide.id}
          >
            {slide.name} {slide.priceLabel}
          </a>
        )
      )}
    </div>
  ),
}));

import type { Product } from '../types';
import { CategoryRecentCarousel } from './CategoryRecentCarousel';

const NO_IMAGE_PRODUCTS = [
  { id: '9', name: 'NoImg', slug: 'x', price: '₦1' },
] as unknown as Product[];

describe('CategoryRecentCarousel image handling', () => {
  it('excludes external placeholder-service images', () => {
    const withExternalPlaceholder = [
      {
        id: 'e1',
        name: 'Placeholder Service Phone',
        slug: 'svc',
        price: '₦1',
        image: 'https://placehold.co/600x600',
      },
      {
        id: 'e2',
        name: 'Genuine Phone',
        slug: 'genuine',
        price: '₦2',
        image: 'https://cdn.ogabassey.com/genuine.avif',
      },
    ] as unknown as Product[];

    render(
      <CategoryRecentCarousel
        categoryName="Smartphones"
        products={withExternalPlaceholder}
      />
    );

    expect(
      screen.getByRole('link', { name: /genuine phone/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/placeholder service phone/i)
    ).not.toBeInTheDocument();
  });

  it('excludes cache-busted placeholder images (query string after the extension)', () => {
    const withCacheBustedPlaceholder = [
      {
        id: 'cb1',
        name: 'Cache Busted Placeholder Phone',
        slug: 'cb',
        price: '₦1',
        image: '/placeholder.svg?cache=1',
      },
      {
        id: 'cb2',
        name: 'Real Phone CB',
        slug: 'real-cb',
        price: '₦2',
        image: 'https://cdn.ogabassey.com/real-cb.avif',
      },
    ] as unknown as Product[];

    render(
      <CategoryRecentCarousel
        categoryName="Smartphones"
        products={withCacheBustedPlaceholder}
      />
    );

    expect(
      screen.getByRole('link', { name: /real phone cb/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/cache busted placeholder phone/i)
    ).not.toBeInTheDocument();
  });

  it('treats /placeholder images as missing and excludes those products', () => {
    const withPlaceholders = [
      { id: 'p1', name: 'Placeholder Phone', slug: 'ph', price: '₦1', image: '/placeholder.svg' },
      { id: 'p2', name: 'Real Phone', slug: 'real', price: '₦2', image: 'https://cdn.ogabassey.com/real.avif' },
    ] as unknown as Product[];

    render(
      <CategoryRecentCarousel
        categoryName="Smartphones"
        products={withPlaceholders}
      />
    );

    expect(
      screen.getByRole('link', { name: /real phone/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/placeholder phone/i)).not.toBeInTheDocument();
  });

  it('falls back past a placeholder primary image to a real gallery entry', () => {
    const withGalleryFallback = [
      {
        id: 'g1',
        name: 'Gallery Phone',
        slug: 'gallery',
        price: '₦3',
        image: '/placeholder.svg',
        images: ['/placeholder.svg', 'https://cdn.ogabassey.com/gallery-2.avif'],
      },
    ] as unknown as Product[];

    render(
      <CategoryRecentCarousel
        categoryName="Smartphones"
        products={withGalleryFallback}
      />
    );

    const slide = screen.getByRole('link', { name: /gallery phone/i });
    expect(slide).toBeInTheDocument();
    expect(slide).toHaveAttribute(
      'data-image',
      'https://cdn.ogabassey.com/gallery-2.avif'
    );
  });

  it('treats whitespace-only images as missing and trims usable ones', () => {
    const withWhitespace = [
      { id: 'w1', name: 'Whitespace Phone', slug: 'ws', price: '₦1', image: '   ' },
      {
        id: 'w2',
        name: 'Padded Phone',
        slug: 'padded',
        price: '₦2',
        image: '  https://cdn.ogabassey.com/padded.avif  ',
      },
    ] as unknown as Product[];

    render(
      <CategoryRecentCarousel
        categoryName="Smartphones"
        products={withWhitespace}
      />
    );

    expect(screen.queryByText(/whitespace phone/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /padded phone/i })
    ).toHaveAttribute('data-image', 'https://cdn.ogabassey.com/padded.avif');
  });

  it('filters image-less products before capping, so eligible later products still surface', () => {
    // 7 products, the 3rd has no image. With a 6-slide cap, filtering first must
    // keep all 6 image-bearing products — including the 7th — instead of letting
    // the image-less product consume a slot and drop the tail.
    const withGap = [
      { id: 'a', name: 'Phone A', slug: 'a', price: '₦1', image: 'i-a' },
      { id: 'b', name: 'Phone B', slug: 'b', price: '₦1', image: 'i-b' },
      { id: 'c', name: 'No Image C', slug: 'c', price: '₦1' },
      { id: 'd', name: 'Phone D', slug: 'd', price: '₦1', image: 'i-d' },
      { id: 'e', name: 'Phone E', slug: 'e', price: '₦1', image: 'i-e' },
      { id: 'f', name: 'Phone F', slug: 'f', price: '₦1', image: 'i-f' },
      { id: 'g', name: 'Phone G', slug: 'g', price: '₦1', image: 'i-g' },
    ] as unknown as Product[];

    render(
      <CategoryRecentCarousel categoryName="Smartphones" products={withGap} />
    );

    expect(
      screen.getByRole('link', { name: /phone g/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/no image c/i)).not.toBeInTheDocument();
  });

  it('renders nothing when no products have images and there is no category image', () => {
    const { container } = render(
      <CategoryRecentCarousel
        categoryName="Smartphones"
        products={NO_IMAGE_PRODUCTS}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to the category image banner when no products have images', () => {
    render(
      <CategoryRecentCarousel
        categoryImage="https://cdn.ogabassey.com/category-smartphones.avif"
        categoryName="Smartphones"
        products={NO_IMAGE_PRODUCTS}
      />
    );

    // No carousel (no product slides), but the category artwork banner shows.
    expect(screen.queryByTestId('launch-carousel')).not.toBeInTheDocument();
    const banner = screen.getByRole('img', { name: 'Smartphones' });
    expect(banner).toHaveAttribute(
      'src',
      'https://cdn.ogabassey.com/category-smartphones.avif'
    );
    expect(banner).toHaveAttribute('loading', 'lazy');
    expect(
      banner.getAttribute('fetchPriority') ?? banner.getAttribute('fetchpriority')
    ).toBe('low');
  });

  it('ignores a placeholder category image in the fallback', () => {
    const { container } = render(
      <CategoryRecentCarousel
        categoryImage="https://placehold.co/1400x250"
        categoryName="Smartphones"
        products={NO_IMAGE_PRODUCTS}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

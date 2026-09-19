import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '' }),
}));
vi.mock('@/lib/product-url', () => ({
  getProductUrl: (product: { slug?: string }) => `/p/${product.slug}`,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));
// The carousel fallback image now renders through CdnFormatImage (explicit
// per-format <picture>); surface it as a plain <img> so these tests keep
// asserting carousel behavior, not image internals.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));
vi.mock('./AdUnit', () => ({
  AdUnit: ({
    placementKey,
    bootDelayMs,
    loadStrategy,
  }: {
    placementKey: string;
    bootDelayMs?: number;
    loadStrategy?: string;
  }) => (
    <span
      data-boot-delay={String(bootDelayMs)}
      data-load-strategy={loadStrategy}
      data-placement={placementKey}
      data-testid="ad-unit"
    />
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

const PRODUCTS = [
  {
    id: '1',
    name: 'Galaxy A27 5G',
    slug: 'galaxy-a27-5g',
    price: '₦50,000',
    image: 'https://cdn.ogabassey.com/a27.avif',
  },
  {
    id: '2',
    name: 'Itel Power 80',
    slug: 'itel-power-80',
    price: '₦173,860',
    image: 'https://cdn.ogabassey.com/power80.avif',
  },
  {
    id: '3',
    name: 'No Image Phone',
    slug: 'no-image-phone',
    price: '₦1,000',
  },
] as unknown as Product[];

describe('CategoryRecentCarousel', () => {
  it('feeds the most recently-added products into the launch carousel as slides', () => {
    render(
      <CategoryRecentCarousel categoryName="Smartphones" products={PRODUCTS} />
    );

    expect(screen.getByTestId('launch-carousel')).toBeInTheDocument();
    const slide = screen.getByRole('link', {
      name: /galaxy a27 5g ₦50,000/i,
    });
    expect(slide).toHaveAttribute('href', '/p/galaxy-a27-5g');
    expect(slide).toHaveAttribute(
      'data-image',
      'https://cdn.ogabassey.com/a27.avif'
    );
  });

  it('inserts the banner ad as the second slide', () => {
    render(
      <CategoryRecentCarousel categoryName="Smartphones" products={PRODUCTS} />
    );

    const adSlide = screen.getByTestId('ad-slide');
    expect(adSlide).toHaveAttribute('data-index', '1');
    const adUnit = screen.getByTestId('ad-unit');
    expect(adUnit).toHaveAttribute('data-placement', 'CATEGORY_CAROUSEL_BANNER');
    // Loads immediately with a short delay so it's filled before the carousel
    // rotates it into view (~6s), rather than showing a late placeholder.
    expect(adUnit).toHaveAttribute('data-load-strategy', 'immediate');
    expect(adUnit).toHaveAttribute('data-boot-delay', '3000');
  });

  it('skips products without a usable image', () => {
    render(
      <CategoryRecentCarousel categoryName="Smartphones" products={PRODUCTS} />
    );

    expect(screen.queryByText(/no image phone/i)).not.toBeInTheDocument();
  });
});

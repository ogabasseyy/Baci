import { act, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    <img {...props} alt={String(props.alt ?? '')} />
  ),
}));
// Product images now render through CdnFormatImage (explicit per-format
// <picture>). Its real pipeline calls next/image's `getImageProps`; surface it
// as a plain <img> so these tests keep asserting home-card behavior.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...imageProps } = props;

    return <img {...imageProps} alt={String(props.alt ?? '')} />;
  },
}));

import { HomeProductGridCard } from './HomeProductGridCard';

const baseProduct: Product = {
  id: 'product-1',
  name: 'iPhone 17 Pro Max',
  price: '₦2,100,000',
  image: '/iphone.jpg',
  category: 'Smartphones',
  slug: 'iphone-17-pro-max',
  categories: {
    id: 'cat-smartphones',
    name: 'Smartphones',
    slug: 'smartphones',
  },
  description: 'Flagship phone with top-tier camera and performance.',
  condition: 'New',
  images: ['/iphone-black.jpg'],
  rating: 4.8,
};

describe('HomeProductGridCard', () => {
  let observerCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      observe() {
        return;
      }

      disconnect() {
        return;
      }

      unobserve() {
        return;
      }

      takeRecords() {
        return [];
      }
    }

    global.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    observerCallback = null;
    delete (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver;
  });

  it('renders the semantic critical card shell classes', () => {
    const { container } = render(<HomeProductGridCard product={baseProduct} />);

    expect(container.firstElementChild).toHaveClass('ogabassey-home-product-card');
    expect(
      container.querySelector('.ogabassey-home-product-card__media')
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: baseProduct.name })).toHaveClass(
      'ogabassey-home-product-card__image'
    );
  });

  it('renders critical condition badge modifier classes before deferred CSS loads', () => {
    render(
      <HomeProductGridCard
        product={{
          ...baseProduct,
          condition: 'Open Box',
        }}
      />
    );

    expect(screen.getByText('Open Box')).toHaveClass(
      'ogabassey-home-product-card__condition--open-box'
    );
  });

  it('maps canonical condition values to critical badge modifier classes', () => {
    render(
      <HomeProductGridCard
        product={{
          ...baseProduct,
          condition: 'open_box',
        }}
      />
    );

    expect(screen.getByText('open_box')).toHaveClass(
      'ogabassey-home-product-card__condition--open-box'
    );
  });

  it('links to the storefront product details route', () => {
    render(<HomeProductGridCard basePath="/ogabassey" product={baseProduct} />);

    const productLink = screen.getByRole('link', {
      name: `View ${baseProduct.name} for ${baseProduct.price}`,
    });

    expect(productLink).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/iphone-17-pro-max'
    );
    const expectedTitle = baseProduct.brand
      ? `${baseProduct.name} - ${baseProduct.brand}`
      : baseProduct.name;
    expect(productLink).toHaveAttribute('title', expectedTitle);
  });

  it('includes brand names in product link titles when available', () => {
    render(
      <HomeProductGridCard
        basePath="/ogabassey"
        product={{ ...baseProduct, brand: 'Apple' }}
      />
    );

    expect(
      screen.getByRole('link', {
        name: `View ${baseProduct.name} for ${baseProduct.price}`,
      })
    ).toHaveAttribute('title', `${baseProduct.name} - Apple`);
  });

  it('waits to mount deferred images until the card is near the viewport', () => {
    render(<HomeProductGridCard product={baseProduct} deferImageLoading={true} />);

    expect(screen.queryByAltText(baseProduct.name)).not.toBeInTheDocument();

    act(() => {
      observerCallback?.(
        [
          {
            isIntersecting: true,
            target: screen.getByText(baseProduct.name),
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByAltText(baseProduct.name)).toBeInTheDocument();
  });

  it('uses mapped product image alt text for rendered home feed cards', () => {
    render(
      <HomeProductGridCard
        product={{
          ...baseProduct,
          image_alt: 'Black titanium iPhone angled product photo',
        }}
      />
    );

    expect(
      screen.getByRole('img', {
        name: 'Black titanium iPhone angled product photo',
      })
    ).toBeInTheDocument();
  });

  it('keeps even immediately mounted home feed images lazy and low-priority', () => {
    render(
      <HomeProductGridCard product={baseProduct} deferImageLoading={false} />
    );

    const image = screen.getByRole('img', { name: baseProduct.name });

    expect(image).toHaveAttribute('loading', 'lazy');
    expect(
      image.getAttribute('fetchPriority') ?? image.getAttribute('fetchpriority')
    ).toBe('low');
  });

  it('renders lazy product images without hidden styles after activation', () => {
    render(<HomeProductGridCard product={baseProduct} deferImageLoading={true} />);

    act(() => {
      observerCallback?.(
        [
          {
            isIntersecting: true,
            target: screen.getByText(baseProduct.name),
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
    });

    const image = screen.getByRole('img', { name: baseProduct.name });

    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveClass('ogabassey-home-product-card__image');
    expect(image).not.toHaveClass('opacity-0');
    expect(image).not.toHaveClass('invisible');
    expect(image).not.toHaveClass('hidden');
    expect(image).not.toHaveStyle({ opacity: '0' });
  });

  it('renders the stable rating row before interactive card enhancement', () => {
    render(<HomeProductGridCard product={baseProduct} />);

    expect(
      screen.getByRole('img', { name: 'Rated 4.8 out of 5' })
    ).toBeInTheDocument();
    expect(screen.getByText('(4.8)')).toBeInTheDocument();
  });

  it('omits the rating row when a product has no real rating', () => {
    const productWithoutRating = {
      ...baseProduct,
      rating: undefined,
    };

    render(<HomeProductGridCard product={productWithoutRating} />);

    expect(
      screen.getByRole('link', { name: /iPhone 17 Pro Max/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('img', { name: /Rated .* out of 5/ })
    ).not.toBeInTheDocument();
  });

  it('renders blank-image home placeholders as decorative images', () => {
    const { container } = render(
      <HomeProductGridCard
        product={{
          ...baseProduct,
          image: '   ',
          images: ['  '],
          image_alt: 'Should not describe a placeholder',
        }}
      />
    );

    const image = container.querySelector('img');

    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('src', '/placeholder.svg');
  });

});

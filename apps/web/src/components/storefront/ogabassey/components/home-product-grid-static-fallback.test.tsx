import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import { HOME_PRODUCT_GRID_CARD_IMAGE_SIZES } from './product-grid-image-sizes';
import { HomeProductGridStaticFallback } from './home-product-grid-static-fallback';

// The global setup mocks next/image's getImageProps as a raw-src passthrough
// with no srcSet. These parity assertions need the real candidate ladder, so
// restore the real module like ogabassey-image-format-sources.test.ts does.
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

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

const secondProduct: Product = {
  ...baseProduct,
  id: 'product-2',
  name: 'Samsung Galaxy S26',
  price: '₦1,850,000',
  slug: 'samsung-galaxy-s26',
};

describe('HomeProductGridStaticFallback', () => {
  it('renders the section heading, product links, names, and prices with zero JS affordances', () => {
    render(
      <HomeProductGridStaticFallback
        basePath=""
        products={[baseProduct, secondProduct]}
        initialDisplayCount={8}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Featured Products' })
    ).toBeInTheDocument();
    expect(screen.getByText('Best Sellers')).toBeInTheDocument();

    const firstLink = screen.getByRole('link', {
      name: /View iPhone 17 Pro Max for ₦2,100,000/,
    });
    expect(firstLink).toHaveAttribute(
      'href',
      expect.stringContaining('iphone-17-pro-max')
    );
    expect(screen.getByText('Samsung Galaxy S26')).toBeInTheDocument();
    expect(screen.getByText('₦1,850,000')).toBeInTheDocument();

    // No interactive controls: the static snapshot is links + content only.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('respects the initial display count and renders the view-all link', () => {
    render(
      <HomeProductGridStaticFallback
        basePath=""
        products={[baseProduct, secondProduct]}
        initialDisplayCount={1}
      />
    );

    expect(screen.getByText('iPhone 17 Pro Max')).toBeInTheDocument();
    expect(screen.queryByText('Samsung Galaxy S26')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View all products' })
    ).toHaveAttribute('href', '/products');
  });

  it('renders the empty state when there are no products', () => {
    render(<HomeProductGridStaticFallback products={[]} />);

    expect(screen.getByText('No products found.')).toBeInTheDocument();
  });

  it('reserves an inert load-more row when the catalog exceeds the initial count', () => {
    // Geometry twin of the interactive grid's row (same wrapper/pill/count
    // classes) so the gate swap inserts no new boxes; aria-hidden plus a
    // handler-free tabIndex=-1 control, so the dead control takes no tab
    // stop and stays out of the accessibility tree while taps still
    // dispatch click for gate capture and replay.
    const { container } = render(
      <HomeProductGridStaticFallback
        basePath=""
        products={[baseProduct, secondProduct]}
        initialDisplayCount={1}
      />
    );

    // The replay marker lives on the button itself: taps on the status
    // label must not expand the grid after activation.
    const control = screen.getByText('Load More Products');
    expect(control).toHaveAttribute(
      'data-ogabassey-home-products-more',
      'true'
    );
    const row = control.closest('div');
    expect(row).toHaveAttribute('aria-hidden', 'true');
    expect(row?.className).toContain('mt-8 flex flex-col items-center gap-2');
    expect(screen.getByText('Showing 1 of 2 products')).toBeInTheDocument();
    // Themed (not hardcoded red): non-red merchant palettes keep their
    // configured colors on the fallback control, matching the interactive
    // twin's store-primary button.
    expect(control.className).toContain('bg-store-primary');
    expect(control.className).toContain('text-store-primary-text');
  });

  it('omits the load-more row when everything already fits', () => {
    const { container } = render(
      <HomeProductGridStaticFallback
        basePath=""
        products={[baseProduct, secondProduct]}
        initialDisplayCount={8}
      />
    );

    expect(
      container.querySelector('[data-ogabassey-home-products-more="true"]')
    ).toBeNull();
  });

  it('renders images only for the first two cards (LCP bandwidth parity)', () => {
    const thirdProduct: Product = {
      ...secondProduct,
      id: 'product-3',
      name: 'Tecno Camon 40',
    };

    const { container } = render(
      <HomeProductGridStaticFallback
        basePath=""
        products={[baseProduct, secondProduct, thirdProduct]}
      />
    );

    const images = container.querySelectorAll(
      '.ogabassey-home-product-card img'
    );
    expect(images).toHaveLength(2);
    expect(
      container.querySelectorAll(
        '.ogabassey-home-product-card__placeholder'
      )
    ).toHaveLength(1);
  });

  it('emits the resized CDN tier instead of the raw asset URL', () => {
    const cdnProduct: Product = {
      ...baseProduct,
      image:
        'https://cdn.ogabassey.com/core-assets/products/iphone-15-pro-max-black-titanium.avif',
    };

    const { container } = render(
      <HomeProductGridStaticFallback basePath="" products={[cdnProduct]} />
    );

    const img = container.querySelector(
      '.ogabassey-home-product-card img'
    ) as HTMLImageElement;
    expect(img).not.toBeNull();
    const renderedSrc = img.getAttribute('src') ?? '';
    expect(renderedSrc).not.toBe(cdnProduct.image);
    // Resized transform tier, never the multi-hundred-KB raw asset.
    expect(renderedSrc).toContain('width=');
  });

  it('renders an AVIF-free <img> so the fallback can never break pre-hydration', () => {
    const cdnProduct: Product = {
      ...baseProduct,
      image:
        'https://cdn.ogabassey.com/image/format=jpeg/core-assets/products/phone-1.jpg',
    };

    const { container } = render(
      <HomeProductGridStaticFallback basePath="" products={[cdnProduct]} />
    );

    // No AVIF <source>: a failed AVIF transform fires before any client
    // recovery can attach (and never for no-JS readers), permanently
    // breaking those cards. The universally decodable JPEG <img> always
    // renders; the post-swap interactive card keeps its own AVIF tier.
    expect(
      container.querySelector(
        '.ogabassey-home-product-card source[type="image/avif"]'
      )
    ).toBeNull();
    const img = container.querySelector(
      '.ogabassey-home-product-card img'
    );
    expect(img).not.toBeNull();
    const imgSrcSet = img?.getAttribute('srcset') ?? '';
    expect(imgSrcSet).not.toBe('');
    expect(imgSrcSet).not.toContain('format=avif');
    // The <img> still shares the interactive card's sizes ladder and the
    // resized JPEG tier, so the post-swap card hits the same cache keys
    // for the fallback candidates.
    expect(img?.getAttribute('sizes')).toBe(
      HOME_PRODUCT_GRID_CARD_IMAGE_SIZES
    );
  });
});

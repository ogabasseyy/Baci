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

    const row = container.querySelector(
      '[data-ogabassey-home-products-more="true"]'
    );
    expect(row).toHaveAttribute('aria-hidden', 'true');
    expect(row?.className).toContain('mt-8 flex flex-col items-center gap-2');
    expect(screen.getByText('Showing 1 of 2 products')).toBeInTheDocument();
    // Themed (not hardcoded red): non-red merchant palettes keep their
    // configured colors on the fallback control, matching the interactive
    // twin's store-primary button.
    const control = screen.getByText('Load More Products');
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

  it('renders the same <picture> + AVIF tier the interactive card renders (single-fetch swap parity)', () => {
    const cdnProduct: Product = {
      ...baseProduct,
      image:
        'https://cdn.ogabassey.com/image/format=jpeg/core-assets/products/phone-1.jpg',
    };

    const { container } = render(
      <HomeProductGridStaticFallback basePath="" products={[cdnProduct]} />
    );

    // Same DOM shape CdnFormatImage emits: <picture> wrapper, an explicit
    // AVIF <source>, and the universally decodable <img> fallback.
    const picture = container.querySelector(
      '.ogabassey-home-product-card picture'
    );
    expect(picture).not.toBeNull();
    const source = picture?.querySelector('source[type="image/avif"]');
    expect(source).not.toBeNull();
    const avifSrcSet = source?.getAttribute('srcset') ?? '';
    const imgSrcSet =
      picture
        ?.querySelector('img')
        ?.getAttribute('srcset') ?? '';
    expect(avifSrcSet).not.toBe('');
    expect(imgSrcSet).not.toBe('');
    // The AVIF tier is the fallback tier rewritten to format=avif only:
    // identical candidate ladders apart from the format token, so the
    // browser fetches once and the post-swap card hits the same cache keys.
    expect(avifSrcSet).toContain('format=avif');
    expect(imgSrcSet).not.toContain('format=avif');
    const avifCandidates = avifSrcSet.split(/,\s+/);
    const imgCandidates = imgSrcSet.split(/,\s+/);
    expect(avifCandidates).toHaveLength(imgCandidates.length);
    for (const [index, avifCandidate] of avifCandidates.entries()) {
      const [avifUrl, ...avifDescriptors] = avifCandidate.trim().split(/\s+/);
      const [imgUrl, ...imgDescriptors] = (
        imgCandidates[index] ?? ''
      )
        .trim()
        .split(/\s+/);
      expect(avifDescriptors).toEqual(imgDescriptors);
      expect(avifUrl).toBe(
        imgUrl.replace('format=jpeg', 'format=avif')
      );
    }
    // Both tiers share the interactive card's sizes ladder (shared const —
    // byte-identical candidate selection before and after the gate swap).
    expect(source?.getAttribute('sizes')).toBe(
      HOME_PRODUCT_GRID_CARD_IMAGE_SIZES
    );
    expect(
      picture?.querySelector('img')?.getAttribute('sizes')
    ).toBe(HOME_PRODUCT_GRID_CARD_IMAGE_SIZES);
  });
});

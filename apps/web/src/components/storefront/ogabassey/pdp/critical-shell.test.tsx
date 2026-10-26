import { render, screen } from '@testing-library/react';
import type * as NextImageModule from 'next/image';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyPdpCriticalShell } from './critical-shell';
import type { OgabasseyPdpCriticalProduct } from './critical-product';

vi.mock('next/image', async (importOriginal) => ({
  // Keep the REAL getImageProps for the migrated <picture>/AVIF path while the
  // default export stays this suite's attribute-exposing test double.
  ...(await importOriginal<typeof NextImageModule>()),
  default: ({
    alt,
    fetchPriority,
    fill,
    loader,
    loading,
    preload,
    quality,
    sizes,
    src,
  }: {
    alt: string;
    fetchPriority?: string;
    fill?: boolean;
    loader?: (params: {
      quality?: number;
      src: string;
      width: number;
    }) => string;
    loading?: string;
    preload?: boolean;
    quality?: number;
    sizes?: string;
    src: string;
  }) => {
    const resolvedSrc = loader
      ? loader({ quality, src, width: 3840 })
      : src;
    const srcSet = loader
      ? [640, 750]
          .map((width) => `${loader({ quality, src, width })} ${width}w`)
          .join(', ')
      : `${src} 640w`;

    return (
      // biome-ignore lint/performance/noImgElement: next/image test double exposes rendered attributes
      <img
        alt={alt}
        data-fetch-priority={fetchPriority}
        data-fill={String(Boolean(fill))}
        data-loading={loading}
        data-preload={String(Boolean(preload))}
        sizes={sizes}
        src={resolvedSrc}
        srcSet={srcSet}
      />
    );
  },
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a data-prefetch={String(prefetch)} href={href}>
      {children}
    </a>
  ),
}));


const isBefore = (
  first: Element | null | undefined,
  second: Element | null | undefined
): boolean =>
  Boolean(
    first &&
      second &&
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
  );

const defaultProduct: OgabasseyPdpCriticalProduct = {
  brand: 'Samsung',
  categoryName: 'Smartphones',
  categorySlug: 'smartphones',
  condition: 'new',
  id: 'product-1',
  image: 'https://cdn.ogabassey.com/core-assets/products/galaxy-trifold.avif',
  imageVersion: 'lcpv1',
  name: 'Samsung Galaxy Z TriFold',
  price: 5_800_000,
  rating: 0,
  ratingCount: 0,
  reviewCount: 0,
  slug: 'samsung-galaxy-z-trifold',
  stockQuantity: 3,
};

function renderCriticalShell(
  productOverrides: Partial<OgabasseyPdpCriticalProduct> = {},
  children?: ReactNode
) {
  return render(
    <OgabasseyPdpCriticalShell
      basePath=""
      product={{ ...defaultProduct, ...productOverrides }}
    >
      {children}
    </OgabasseyPdpCriticalShell>
  );
}

describe('OgabasseyPdpCriticalShell', () => {
  it('renders one server-owned product heading and high-priority image', () => {
    const { container } = renderCriticalShell(
      {
        brand: 'Lenovo',
        categoryName: 'Laptops',
        categorySlug: 'laptops',
        condition: 'used',
        id: 'product-1',
        image: 'https://cdn.ogabassey.com/core-assets/products/legion.avif',
        name: 'Lenovo Legion Pro 9',
        price: 5_985_000,
        rating: 4.5,
        reviewCount: 12,
        slug: 'lenovo-legion-pro-9',
      },
      <button type="button">Add to Cart</button>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Lenovo Legion Pro 9' })
    ).toBeInTheDocument();
    const productImage = screen.getByRole('img', {
      name: 'Lenovo Legion Pro 9',
    });

    // The critical image renders through the real per-format <picture> path
    // (CdnFormatImage + getImageProps), so assert REAL DOM attributes — not the
    // next/image test-double's data-* markers.
    expect(productImage).toHaveAttribute('fetchpriority', 'high');
    expect(productImage).toHaveAttribute('loading', 'eager');
    const picture = productImage.closest('picture');
    expect(picture).not.toBeNull();
    expect(
      picture?.querySelector('source[type="image/avif"]')
    ).not.toBeNull();
    expect(productImage).not.toHaveAttribute('loader');
    expect(productImage).not.toHaveAttribute('priority');
    expect(productImage).not.toHaveAttribute('quality');
    expect(productImage).not.toHaveAttribute('fill');
    // Exactly ONE <source>: the AVIF tier asserted above — no stray extras.
    expect(document.querySelectorAll('source')).toHaveLength(1);
    expect(productImage).toHaveAttribute(
      'sizes',
      '(max-width: 767.98px) calc(100vw - 32px), (max-width: 1023px) calc(100vw - 48px), (max-width: 1439px) 40vw, 560px'
    );
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'href',
      '/laptops'
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(
      screen.getByRole('button', { name: 'Add to Cart' })
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-summary-variant-slot]')
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-price-live]')
    ).not.toBeInTheDocument();
  });

  it('formats the static price in NGN by default', () => {
    renderCriticalShell({ price: 999_900 });
    expect(screen.getByText('₦999,900')).toBeInTheDocument();
  });

  it('formats the static price in the merchant-resolved currency when supplied', () => {
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        currency={{ code: 'INR', symbol: '₹', locale: 'en-IN' }}
        product={{ ...defaultProduct, price: 999_900 }}
      />
    );

    expect(screen.getByText('₹9,99,900')).toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-price-static]')
    ).toHaveTextContent('₹9,99,900');
  });

  it('renders summary commerce content natively in the product summary', () => {
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={defaultProduct}
        summaryCommerce={
          <div data-testid="native-summary-commerce">Variant controls</div>
        }
      >
        <button type="button">Add to Cart</button>
      </OgabasseyPdpCriticalShell>
    );

    expect(screen.getByTestId('native-summary-commerce')).toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-price-static]')
    ).not.toBeInTheDocument();
  });

  it('omits the rating row and "No reviews yet" copy when a product has no reviews or ratings', () => {
    const { container } = renderCriticalShell({
      rating: 0,
      ratingCount: 0,
      reviewCount: 0,
    });

    expect(
      container.querySelector('[data-ogabassey-pdp-rating-row]')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/out of 5 stars/i)).not.toBeInTheDocument();
    expect(screen.queryByText('★★★★★')).not.toBeInTheDocument();
  });

  it('renders an honest rating signal for products with reviews', () => {
    renderCriticalShell({ rating: 4.5, reviewCount: 25 });

    expect(
      screen.getByRole('img', { name: '4.5 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('4.5 ★')).toBeInTheDocument();
    expect(screen.getByText('25 Reviews')).toBeInTheDocument();
    expect(screen.queryByText('★★★★★')).not.toBeInTheDocument();
  });

  it('uses singular review copy for one review', () => {
    renderCriticalShell({ rating: 4, reviewCount: 1 });

    expect(screen.getByText('1 Review')).toBeInTheDocument();
  });

  it('renders rating-count-only aggregate ratings as ratings, not reviews', () => {
    const { rerender } = renderCriticalShell({
      rating: 4.5,
      ratingCount: 12,
      reviewCount: 0,
    });

    expect(
      screen.getByRole('img', { name: '4.5 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('12 Ratings')).toBeInTheDocument();
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument();
    expect(screen.queryByText('12 Reviews')).not.toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{
          ...defaultProduct,
          rating: 4,
          ratingCount: 1,
          reviewCount: 0,
        }}
      />
    );

    expect(
      screen.getByRole('img', { name: '4 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('1 Rating')).toBeInTheDocument();
  });

  it('displays review count when both reviews and ratings exist', () => {
    renderCriticalShell({ rating: 4.5, ratingCount: 12, reviewCount: 5 });

    expect(
      screen.getByRole('img', { name: '4.5 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('5 Reviews')).toBeInTheDocument();
    expect(screen.queryByText('12 Ratings')).not.toBeInTheDocument();
  });

  it('renders brand, title, rating row, price, and visible summary in the expected summary DOM order', () => {
    const { container } = renderCriticalShell({
      brand: 'Samsung',
      name: 'Samsung Galaxy Z TriFold',
      price: 5_800_000,
      rating: 4.5,
      reviewCount: 10,
      visibleSummary: 'Samsung Galaxy Z TriFold summary overview.',
    });

    const summary = container.querySelector('[data-ogabassey-pdp-summary]');
    expect(summary).not.toBeNull();

    const brand = summary?.querySelector('[data-ogabassey-pdp-brand]');
    const title = summary?.querySelector('h1[data-ogabassey-pdp-title]');
    const ratingRow = summary?.querySelector('[data-ogabassey-pdp-rating-row]');
    const price = summary?.querySelector('[data-ogabassey-pdp-price]');
    const visibleSummary = summary?.querySelector(
      '[data-ogabassey-pdp-visible-summary]'
    );

    expect(brand).toBeInTheDocument();
    expect(title).toBeInTheDocument();
    expect(ratingRow).toBeInTheDocument();
    expect(price).toBeInTheDocument();
    expect(visibleSummary).toBeInTheDocument();

    expect(isBefore(brand, title)).toBe(true);
    expect(isBefore(title, ratingRow)).toBe(true);
    expect(isBefore(ratingRow, price)).toBe(true);
    expect(isBefore(price, visibleSummary)).toBe(true);
  });

  it('renders summaryCommerce ahead of visible summary when provided', () => {
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{
          ...defaultProduct,
          visibleSummary: 'Samsung Galaxy Z TriFold summary overview.',
        }}
        summaryCommerce={
          <div data-testid="summary-commerce">Commerce Options</div>
        }
      />
    );

    const summary = container.querySelector('[data-ogabassey-pdp-summary]');
    const commerce = summary?.querySelector('[data-testid="summary-commerce"]');
    const visibleSummary = summary?.querySelector(
      '[data-ogabassey-pdp-visible-summary]'
    );

    expect(commerce).toBeInTheDocument();
    expect(visibleSummary).toBeInTheDocument();
    expect(isBefore(commerce, visibleSummary)).toBe(true);
  });

  it('shows review count without a rating signal when rating is zero', () => {
    renderCriticalShell({ rating: 0, reviewCount: 3 });

    expect(screen.getByText('3 Reviews')).toBeInTheDocument();
    expect(screen.queryByLabelText(/out of 5 stars/i)).not.toBeInTheDocument();
  });

  it('clamps rendered rating values to the valid five-star range', () => {
    const { rerender } = renderCriticalShell({ rating: 5, reviewCount: 3 });

    expect(
      screen.getByRole('img', { name: '5 out of 5 stars' })
    ).toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{ ...defaultProduct, rating: 5.8, reviewCount: 3 }}
      />
    );

    expect(
      screen.getByRole('img', { name: '5 out of 5 stars' })
    ).toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{ ...defaultProduct, rating: -1, reviewCount: 3 }}
      />
    );

    expect(screen.queryByLabelText(/out of 5 stars/i)).not.toBeInTheDocument();
  });
});

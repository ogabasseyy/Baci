import { render, screen, within } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { makeProduct } from './product-index-card.test-fixtures';

const {
  mockGetCachedCategories,
  mockGetCachedStorefrontProductIndex,
  mockGetRequestScopedMerchant,
  mockGetStorefrontPathPrefix,
  mockHeaders,
} = vi.hoisted(() => ({
  mockGetCachedCategories: vi.fn(),
  mockGetCachedStorefrontProductIndex: vi.fn(),
  mockGetRequestScopedMerchant: vi.fn(),
  mockGetStorefrontPathPrefix: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock(
  '@/components/storefront/experience/experience-server-boundary',
  () => ({
    ExperienceServerBoundary: ({ fallback }: { fallback: React.ReactNode }) =>
      fallback,
  })
);
vi.mock('next/headers', () => ({ headers: () => mockHeaders() }));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    fill: _fill,
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
  }) => (
    // biome-ignore lint/performance/noImgElement: test mock for next/image
    <img alt={alt} src={typeof src === 'string' ? src : ''} {...props} />
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock(
  '@/components/storefront/ogabassey/components/StorefrontPagination',
  () => ({
    StorefrontPagination: () => null,
  })
);
vi.mock('@/lib/cached-data', () => ({
  getCachedCategories: (...args: unknown[]) => mockGetCachedCategories(...args),
  getStorefrontCategories: async (...args: unknown[]) => {
    try {
      return {
        categories: await mockGetCachedCategories(...args),
        queryFailed: false,
      };
    } catch {
      return { categories: [], queryFailed: true };
    }
  },
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
}));
vi.mock('@/lib/cached-storefront-product-index', () => ({
  getCachedStorefrontProductIndex: (...args: unknown[]) =>
    mockGetCachedStorefrontProductIndex(...args),
}));
vi.mock('@/lib/routes', () => ({ asRoute: (path: string) => path }));
vi.mock('@/components/seo/json-ld', () => ({ JsonLd: () => null }));
vi.mock('@/lib/seo-utils', () => ({
  generateBreadcrumbSchema: vi.fn(() => ({})),
  generateCollectionPageSchema: vi.fn(() => ({})),
  getProductUrl: (product: { slug?: string; id?: string }) =>
    `/products/${product.slug || product.id}`,
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));
vi.mock('@/lib/storefront-path-prefix', () => ({
  getStorefrontPathPrefix: (...args: unknown[]) =>
    mockGetStorefrontPathPrefix(...args),
}));
vi.mock('@/lib/validation', () => ({ isValidMerchantIdentifier: () => true }));

const { ProductsPageContent } = await import('./products-page-content');

const mockMerchant = {
  id: 'merchant-ogabassey',
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  country: 'NG',
  payout_currency: 'NGN',
  site_description: 'Best gadgets in Nigeria',
};

const sampleProduct: NormalizedProduct = makeProduct({
  id: 'prod-1',
  name: 'Google Pixel 9 Pro',
  slug: 'google-pixel-9-pro',
  price: 1200000,
  image: 'https://cdn.example.com/pixel9.jpg',
  images: ['https://cdn.example.com/pixel9.jpg'],
  category: 'Smartphones',
  category_slug: 'smartphones',
  available_conditions: ['new'],
  has_condition_offers: false,
});

describe('ProductsPageContent accessibility & heading outline semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetCachedCategories.mockResolvedValue([
      { id: 'cat-1', name: 'Smartphones', slug: 'smartphones' },
    ]);
    mockGetRequestScopedMerchant.mockResolvedValue(mockMerchant);
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      products: [sampleProduct],
      totalCount: 1,
      totalPages: 1,
    });
  });

  it('renders WCAG breadcrumb, aria-live range, and section outlines for apex custom domains (pathPrefix = "")', async () => {
    mockGetStorefrontPathPrefix.mockReturnValue('');

    const page = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(page as React.ReactElement);

    // 1. Breadcrumb navigation semantics
    const breadcrumbNav = screen.getByRole('navigation', {
      name: 'Breadcrumb',
    });
    expect(breadcrumbNav).toBeInTheDocument();
    const breadcrumbList = within(breadcrumbNav).getByRole('list');
    expect(breadcrumbList).toBeInTheDocument();

    const homeLink = within(breadcrumbList).getByRole('link', { name: 'Home' });
    expect(homeLink).toHaveAttribute('href', '/');

    const terminalItem = within(breadcrumbList).getByText('Products', {
      selector: '[aria-current="page"]',
    });
    expect(terminalItem).toBeInTheDocument();

    // 2. Count summary has aria-live="polite"
    const countSummary = screen.getByText(/Showing 1-1 of 1 products/);
    expect(countSummary).toHaveAttribute('aria-live', 'polite');

    // 3. Product catalog section with sr-only H2 heading
    const catalogHeading = screen.getByRole('heading', {
      level: 2,
      name: 'Product Catalog',
    });
    expect(catalogHeading).toHaveClass('sr-only');
    expect(catalogHeading).toHaveAttribute('id', 'products-catalog-heading');

    const catalogSection = catalogHeading.closest('section');
    expect(catalogSection).not.toBeNull();
    expect(catalogSection).toHaveAttribute(
      'aria-labelledby',
      'products-catalog-heading'
    );
    if (catalogSection) {
      expect(
        within(catalogSection).getByRole('group', { name: 'Product Catalog' })
      ).toBeInTheDocument();
    }

    // 4. ProductIndexCard renders H3 heading and grid position semantics
    const productHeading = screen.getByRole('heading', {
      level: 3,
      name: 'Google Pixel 9 Pro',
    });
    expect(productHeading).toBeInTheDocument();

    const productCard = productHeading.closest('article');
    expect(productCard).toHaveAttribute('aria-posinset', '1');
    expect(productCard).toHaveAttribute('aria-setsize', '1');
  });

  it('renders WCAG breadcrumbs with prefixed Home link for subpath storefronts (pathPrefix = "/ogabassey")', async () => {
    mockGetStorefrontPathPrefix.mockReturnValue('/ogabassey');

    const page = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(page as React.ReactElement);

    const breadcrumbNav = screen.getByRole('navigation', {
      name: 'Breadcrumb',
    });
    expect(breadcrumbNav).toBeInTheDocument();
    const breadcrumbList = within(breadcrumbNav).getByRole('list');

    const homeLink = within(breadcrumbList).getByRole('link', { name: 'Home' });
    expect(homeLink).toHaveAttribute('href', '/ogabassey');

    const terminalItem = within(breadcrumbList).getByText('Products', {
      selector: '[aria-current="page"]',
    });
    expect(terminalItem).toBeInTheDocument();

    // Verify catalog outline and position semantics are also present in subpath mode
    expect(
      screen.getByRole('heading', { level: 2, name: 'Product Catalog' })
    ).toBeInTheDocument();
    const productHeading = screen.getByRole('heading', {
      level: 3,
      name: 'Google Pixel 9 Pro',
    });
    expect(productHeading).toBeInTheDocument();
    const productCard = productHeading.closest('article');
    expect(productCard).toHaveAttribute('aria-posinset', '1');
    expect(productCard).toHaveAttribute('aria-setsize', '1');
  });
});

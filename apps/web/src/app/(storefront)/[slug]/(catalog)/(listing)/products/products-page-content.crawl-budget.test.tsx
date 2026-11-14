import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';

const {
  mockGetCachedStorefrontProductIndex,
  mockGetRequestScopedMerchant,
  mockGetStorefrontCategories,
  mockHeaders,
  mockLoadProductsPageLinkModules,
  mockStorefrontPagination,
} = vi.hoisted(() => ({
  mockGetCachedStorefrontProductIndex: vi.fn(),
  mockGetRequestScopedMerchant: vi.fn(),
  mockGetStorefrontCategories: vi.fn(),
  mockHeaders: vi.fn(),
  mockLoadProductsPageLinkModules: vi.fn(),
  mockStorefrontPagination: vi.fn((_props: Record<string, unknown>) => null),
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
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock(
  '@/components/storefront/ogabassey/components/StorefrontPagination',
  () => ({
    StorefrontPagination: (props: Record<string, unknown>) =>
      mockStorefrontPagination(props),
  })
);
vi.mock('@/lib/cached-data', () => ({
  getCachedCategories: async () => [],
  getStorefrontCategories: (...args: unknown[]) =>
    mockGetStorefrontCategories(...args),
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
  generateBreadcrumbSchema: () => ({}),
  generateCollectionPageSchema: () => ({}),
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));
vi.mock('@/lib/validation', () => ({ isValidMerchantIdentifier: () => true }));
vi.mock('./product-index-card', () => ({
  ProductIndexCard: () => <article />,
}));
vi.mock('./products-page-link-modules', () => ({
  loadProductsPageLinkModules: (...args: unknown[]) =>
    mockLoadProductsPageLinkModules(...args),
}));
vi.mock('./products-page-deferred-link-modules', () => ({
  ProductsPageDeferredLinkModules: (props: Record<string, unknown>) => {
    mockLoadProductsPageLinkModules(props);
    return (
      <section aria-label="Explore Ogabassey buying paths">
        <a href={`${props.pathPrefix}/smartphones/compare/a-vs-b`}>Compare</a>
      </section>
    );
  },
}));

const { ProductsPageContent } = await import('./products-page-content');

const mockMerchant = {
  id: OGABASSEY_MERCHANT_ID,
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
  country: 'NG',
  payout_currency: 'NGN',
  site_description: 'Browse products',
};

const mockCategories = [
  { id: 'cat-1', name: 'Smartphones', slug: 'smartphones', is_active: true },
  { id: 'cat-2', name: 'Laptops', slug: 'laptops', is_active: true },
];

describe('ProductsPageContent crawl budget & link modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetRequestScopedMerchant.mockResolvedValue(mockMerchant);
    mockGetStorefrontCategories.mockResolvedValue({
      categories: mockCategories,
      queryFailed: false,
    });
  });

  it('enables crawl discovery pagination with threshold 20 and maxLinks 24 on page 1', async () => {
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 1280,
      totalPages: 64,
      products: [
        {
          id: 'prod-1',
          name: 'Galaxy S25',
          slug: 'galaxy-s25',
          price: 2500,
          images: [],
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
    });

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(result as React.ReactElement);

    expect(mockGetCachedStorefrontProductIndex).toHaveBeenCalledTimes(1);
    expect(mockLoadProductsPageLinkModules).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: OGABASSEY_MERCHANT_ID,
        productTotalPages: 64,
      })
    );
    expect(
      screen.getByRole('region', { name: 'Explore Ogabassey buying paths' })
    ).toBeInTheDocument();
    expect(mockStorefrontPagination).toHaveBeenCalledWith(
      expect.objectContaining({
        ariaLabel: 'Products pagination',
        basePath: '/ogabassey/products',
        crawlDiscoveryAllPagesThreshold: 20,
        crawlDiscoveryLabel: 'Browse product index pages',
        crawlDiscoveryMaxLinks: 24,
        crawlDiscoveryPageLabel: 'Products page',
        currentPage: 1,
        totalPages: 64,
      })
    );
  });

  it('keeps crawl discovery pagination on page 2+ while skipping deferred link modules', async () => {
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 40,
      totalPages: 2,
      products: [
        {
          id: 'prod-2',
          name: 'Second Page Product',
          slug: 'second-page-product',
          price: 3000,
          images: [],
          category_slug: 'smartphones',
        },
      ],
    });

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    render(result as React.ReactElement);

    expect(mockGetCachedStorefrontProductIndex).toHaveBeenCalledTimes(1);
    expect(mockGetCachedStorefrontProductIndex).toHaveBeenCalledWith(
      OGABASSEY_MERCHANT_ID,
      expect.objectContaining({ page: 2 })
    );
    expect(mockLoadProductsPageLinkModules).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Explore Ogabassey buying paths' })
    ).not.toBeInTheDocument();
    expect(mockStorefrontPagination).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPage: 2,
        crawlDiscoveryAllPagesThreshold: 20,
        crawlDiscoveryLabel: 'Browse product index pages',
        crawlDiscoveryMaxLinks: 24,
      })
    );
  });
});

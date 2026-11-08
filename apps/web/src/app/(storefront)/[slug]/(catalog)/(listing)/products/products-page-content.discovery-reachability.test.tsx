import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { getStorefrontCrawlDiscoveryPages } from '@/lib/storefront-pagination';

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

describe('ProductsPageContent discovery pagination & category link deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetRequestScopedMerchant.mockResolvedValue(mockMerchant);
    mockGetStorefrontCategories.mockResolvedValue({
      categories: mockCategories,
      queryFailed: false,
    });
  });

  it('renders category links with pathPrefix = "/ogabassey" on path-prefixed storefront', async () => {
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 20,
      totalPages: 1,
      products: [],
    });

    const headersList = new Headers();
    headersList.set('host', 'usebaci.com');
    mockHeaders.mockResolvedValue(headersList);

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({}),
    });

    render(result as React.ReactElement);

    const smartphonesLink = screen.getByRole('link', { name: 'Smartphones' });
    expect(smartphonesLink).toHaveAttribute('href', '/ogabassey/smartphones');
    const laptopsLink = screen.getByRole('link', { name: 'Laptops' });
    expect(laptopsLink).toHaveAttribute('href', '/ogabassey/laptops');
  });

  it('renders category links with pathPrefix = "" on apex custom domain', async () => {
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 20,
      totalPages: 1,
      products: [],
    });

    const headersList = new Headers();
    headersList.set('host', 'ogabassey.com');
    headersList.set('x-forwarded-host', 'ogabassey.com');
    headersList.set('x-custom-domain', 'ogabassey.com');
    mockHeaders.mockResolvedValue(headersList);

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({}),
    });

    render(result as React.ReactElement);

    const smartphonesLink = screen.getByRole('link', { name: 'Smartphones' });
    expect(smartphonesLink).toHaveAttribute('href', '/smartphones');
    const laptopsLink = screen.getByRole('link', { name: 'Laptops' });
    expect(laptopsLink).toHaveAttribute('href', '/laptops');
  });

  it('ensures each category link appears once and is not duplicated in link modules', async () => {
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 20,
      totalPages: 1,
      products: [],
    });

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(result as React.ReactElement);

    const smartphonesLinks = screen.getAllByRole('link', {
      name: 'Smartphones',
    });
    expect(smartphonesLinks).toHaveLength(1);
    expect(smartphonesLinks[0]?.getAttribute('href')).toBe(
      '/ogabassey/smartphones'
    );
  });

  it('caps discovery pagination links on page 1 with totalPages = 80 to 24 links', () => {
    const discoveryPages = getStorefrontCrawlDiscoveryPages({
      totalPages: 80,
      currentPage: 1,
      allPagesThreshold: 20,
      maxPages: 24,
    });

    expect(discoveryPages.length).toBeLessThanOrEqual(24);
    expect(discoveryPages).toHaveLength(24);
    expect(discoveryPages).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 71, 72, 73, 74, 75, 76, 77,
      78, 79, 80,
    ]);
  });

  it('satisfies BFS graph traversal reachability across all pages 1..80 within max 11 hops and 100% sequential reachability', () => {
    const totalPages = 80;

    function getEmittedPageLinks(p: number): Set<number> {
      const targets = new Set<number>();

      if (p > 1) {
        targets.add(p - 1);
      }
      if (p < totalPages) {
        targets.add(p + 1);
      }

      targets.add(1);
      targets.add(totalPages);
      for (let page = p - 1; page <= p + 1; page++) {
        if (page >= 1 && page <= totalPages) {
          targets.add(page);
        }
      }

      const discoveryPages = getStorefrontCrawlDiscoveryPages({
        totalPages,
        currentPage: p,
        allPagesThreshold: 20,
        maxPages: 24,
      });
      for (const dp of discoveryPages) {
        targets.add(dp);
      }

      return targets;
    }

    const adjacency = new Map<number, Set<number>>();
    for (let p = 1; p <= totalPages; p++) {
      adjacency.set(p, getEmittedPageLinks(p));
    }

    let currentPage = 1;
    let sequentialCount = 1;
    while (currentPage < totalPages) {
      const nextPage = currentPage + 1;
      expect(adjacency.get(currentPage)?.has(nextPage)).toBe(true);
      currentPage = nextPage;
      sequentialCount++;
    }
    expect(sequentialCount).toBe(totalPages);

    const queue = [1];
    const distance = new Map<number, number>([[1, 0]]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      const currentDist = distance.get(current) ?? 0;
      const neighbors = adjacency.get(current) ?? new Set();

      for (const neighbor of neighbors) {
        if (!distance.has(neighbor)) {
          distance.set(neighbor, currentDist + 1);
          queue.push(neighbor);
        }
      }
    }

    expect(distance.size).toBe(totalPages);
    for (let p = 1; p <= totalPages; p++) {
      expect(distance.has(p)).toBe(true);
    }

    const maxHopDistance = Math.max(...Array.from(distance.values()));
    expect(maxHopDistance).toBeLessThanOrEqual(11);
  });
});

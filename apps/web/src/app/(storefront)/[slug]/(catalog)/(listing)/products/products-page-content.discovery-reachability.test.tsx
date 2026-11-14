import { render, screen, within } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontPagination } from '@/components/storefront/ogabassey/components/StorefrontPagination';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { buildCatalogLinkModules } from '@/lib/storefront-link-modules/build-catalog-link-modules';
import { getStorefrontCrawlDiscoveryPages } from '@/lib/storefront-pagination';

const {
  mockGetCachedStorefrontProductIndex,
  mockGetRequestScopedMerchant,
  mockGetStorefrontCategories,
  mockHeaders,
  mockLoadProductsPageLinkModules,
} = vi.hoisted(() => ({
  mockGetCachedStorefrontProductIndex: vi.fn(),
  mockGetRequestScopedMerchant: vi.fn(),
  mockGetStorefrontCategories: vi.fn(),
  mockHeaders: vi.fn(),
  mockLoadProductsPageLinkModules: vi.fn(),
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
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
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

const { ProductsPageContent } = await import('./products-page-content');
const { ProductsPageDeferredLinkModules } = await import(
  './products-page-deferred-link-modules'
);

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

function parsePageNumberFromHref(href: string | null): number | null {
  if (!href) return null;
  if (href === '/products') return 1;
  const match = href.match(/^\/products\?page=(\d+)$/);
  return match ? Number(match[1]) : null;
}

describe('ProductsPageContent discovery pagination & category link deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetRequestScopedMerchant.mockResolvedValue(mockMerchant);
    mockGetStorefrontCategories.mockResolvedValue({
      categories: mockCategories,
      queryFailed: false,
    });
    mockLoadProductsPageLinkModules.mockImplementation(async () =>
      buildCatalogLinkModules({
        compareLinks: [
          {
            href: '/smartphones/compare/iphone-16-vs-galaxy-s25',
            label: 'iPhone 16 vs Galaxy S25',
          },
        ],
        editorialLinks: [],
      })
    );
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

    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones'
    );
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'href',
      '/ogabassey/laptops'
    );
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

    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/smartphones'
    );
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'href',
      '/laptops'
    );
  });

  it('ensures each category href appears once across ProductsPageContent and real deferred link modules', async () => {
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 20,
      totalPages: 1,
      products: [],
    });

    const pageElement = await ProductsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ page: '1' }),
    });
    const deferredElement = await ProductsPageDeferredLinkModules({
      baseUrl: 'https://ogabassey.com',
      categories: mockCategories.map((c) => ({
        ...c,
        canonicalSlug: c.slug,
        description: null,
        image_url: null,
        parent_id: null,
      })),
      merchantId: OGABASSEY_MERCHANT_ID,
      pathPrefix: '/ogabassey',
      productTotalPages: 1,
    });

    const { container } = render(
      <>
        {pageElement}
        {deferredElement}
      </>
    );

    const allHrefs = Array.from(container.querySelectorAll('a')).map((a) =>
      a.getAttribute('href')
    );
    expect(
      allHrefs.filter((href) => href === '/ogabassey/smartphones')
    ).toHaveLength(1);
    expect(
      allHrefs.filter((href) => href === '/ogabassey/laptops')
    ).toHaveLength(1);
    expect(allHrefs).toContain(
      '/ogabassey/smartphones/compare/iphone-16-vs-galaxy-s25'
    );
  });

  it('caps discovery pagination links on page 1 with totalPages = 80 to 24 links', () => {
    const discoveryPages = getStorefrontCrawlDiscoveryPages({
      totalPages: 80,
      currentPage: 1,
      allPagesThreshold: 20,
      maxPages: 24,
    });

    expect(discoveryPages).toHaveLength(24);
    expect(discoveryPages).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 71, 72, 73, 74, 75, 76, 77,
      78, 79, 80,
    ]);
  });

  it('satisfies BFS reachability across all pages 1..80 within <= 11 hops from rendered StorefrontPagination links', () => {
    const totalPages = 80;
    const adjacency = new Map<number, Set<number>>();

    for (let p = 1; p <= totalPages; p++) {
      const { container, unmount } = render(
        <StorefrontPagination
          ariaLabel="Products pagination"
          basePath="/products"
          crawlDiscoveryAllPagesThreshold={20}
          crawlDiscoveryLabel="Browse product index pages"
          crawlDiscoveryMaxLinks={24}
          crawlDiscoveryPageLabel="Products page"
          currentPage={p}
          totalPages={totalPages}
        />
      );

      if (p < totalPages) {
        const nextLink = within(container).getByRole('link', { name: /next/i });
        expect(nextLink).toHaveAttribute('href', `/products?page=${p + 1}`);
      }

      const targets = new Set<number>();
      for (const anchor of Array.from(container.querySelectorAll('a'))) {
        const pageNum = parsePageNumberFromHref(anchor.getAttribute('href'));
        if (pageNum !== null && pageNum !== p) {
          targets.add(pageNum);
        }
      }
      adjacency.set(p, targets);
      unmount();
    }

    const queue = [1];
    const distance = new Map<number, number>([[1, 0]]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const currentDist = distance.get(current) ?? 0;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!distance.has(neighbor)) {
          distance.set(neighbor, currentDist + 1);
          queue.push(neighbor);
        }
      }
    }

    expect(distance.size).toBe(totalPages);
    expect(Math.max(...Array.from(distance.values()))).toBeLessThanOrEqual(11);
  });
});

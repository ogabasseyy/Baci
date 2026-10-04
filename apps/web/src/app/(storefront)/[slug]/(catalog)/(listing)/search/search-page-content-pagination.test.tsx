import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { getStorefrontSearchProducts } from '@/lib/storefront-search';

const { mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: (...args: unknown[]) => mockNotFound(...args),
  redirect: (...args: unknown[]) => mockRedirect(...args),
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: vi.fn(),
  getStorefrontSearchProducts: vi.fn(),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
}));

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch: _prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => <a {...props}>{children}</a>,
}));

vi.mock('../products/product-index-card', () => ({
  ProductIndexCard: ({
    pathPrefix,
    product,
  }: {
    pathPrefix: string;
    product: { name: string };
  }) => (
    <div>
      <span>{product.name}</span>
      <span data-testid={`path-prefix-${product.name}`}>{pathPrefix}</span>
    </div>
  ),
}));

const { SearchPageContent } = await import('./search-page-content');
const mockGetStorefrontSearchProducts = vi.mocked(getStorefrontSearchProducts);

function createSearchPageProps(
  searchParams: {
    brand?: string;
    condition?: string;
    max_price?: string;
    min_price?: string;
    page?: string | string[];
    q?: string | string[];
    sort?: string;
  } = {}
) {
  return {
    params: Promise.resolve({ slug: 'ogabassey' }),
    searchParams: Promise.resolve({
      page: '1',
      ...searchParams,
    }),
  };
}

function createSearchProducts(count: number): NormalizedProduct[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `product-${index + 1}`,
    name: index === 0 ? 'iPhone 16' : `iPhone ${index + 17}`,
    price: 1_200_000 + index * 1000,
    slug: index === 0 ? 'iphone-16' : `iphone-${index + 17}`,
    category: 'Phones',
    category_slug: 'phones',
  })) as NormalizedProduct[];
}

function mockStorefrontContext() {
  mockHeaders.mockResolvedValue(
    new Headers([
      ['host', 'proxy.internal'],
      ['x-pathname', '/ogabassey/search'],
    ])
  );

  vi.mocked(getRequestScopedMerchant).mockResolvedValue({
    id: 'merchant-1',
    slug: 'ogabassey',
    custom_domain: null,
    business_name: 'Ogabassey',
    payout_currency: 'NGN',
  } as never);
}

describe('SearchPageContent', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    mockGetStorefrontSearchProducts.mockReset();
    mockHeaders.mockReset();
    mockRedirect.mockReset();
    mockNotFound.mockReset();
  });

  it('keeps other pages reachable when every hydrated product disappears', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 20,
      totalCount: 40,
      products: [],
      productIds: [],
      query: 'iphone',
      didYouMean: null,
    });
    render(await SearchPageContent(createSearchPageProps({ q: 'iphone' })));
    expect(
      screen.getByText(
        'Products on this page are no longer available. Try another page.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      expect.stringContaining('page=2')
    );
  });

  it('pages past the first 20 matches without recording a new submission', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 45,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '2' })
      )) as React.ReactElement
    );

    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(1);
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        query: 'iphone',
        limit: 20,
        offset: 20,
      })
    );
    expect(
      screen.getByText(/Showing 21–40 of 45 results for “iphone”/i)
    ).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();

    // Query-preserving pagination with a truthful current-page marker.
    const pagination = screen.getByRole('navigation', {
      name: /search results pagination/i,
    });
    expect(pagination).toBeInTheDocument();
    // Page-1 returns carry an explicit page parameter so landing on them
    // never counts as a fresh search submission.
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute(
      'href',
      '/ogabassey/search?q=iphone&page=1'
    );
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute(
      'href',
      '/ogabassey/search?q=iphone&page=3'
    );
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    const schemas = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    ).map(
      (script) =>
        JSON.parse(script.textContent || '{}') as {
          '@type'?: string;
          url?: string;
          mainEntity?: {
            itemListElement?: Array<{ position?: number }>;
          };
        }
    );
    const collectionSchema = schemas.find(
      (schema) => schema['@type'] === 'CollectionPage'
    );
    expect(collectionSchema?.url).toContain('page=2');
    expect(collectionSchema?.mainEntity?.itemListElement?.[0]?.position).toBe(
      21
    );
  });

  it('does not record a page-less results render as a new search', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 45,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: undefined })
      )) as React.ReactElement
    );

    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 })
    );
  });

  it('does not record an explicit page-1 navigation as a new search', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 45,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '1' })
      )) as React.ReactElement
    );

    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 })
    );
  });

  it('does not track results renders across a page 1 → 2 → 1 journey', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValue({
      count: 45,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    // Fresh submission entry: no page parameter.
    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: undefined })
      )) as React.ReactElement
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0 })
    );

    // Paging forward is navigation, not a submission.
    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '2' })
      )) as React.ReactElement
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 20 })
    );

    // Returning to page 1 via the Previous link (explicit page=1) must not
    // recount the original submission.
    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '1' })
      )) as React.ReactElement
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0 })
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(3);
  });
});

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

  it('recovers an out-of-range page through an untracked first-page probe', async () => {
    mockStorefrontContext();
    // The RPC reports its total only on returned rows, so the out-of-range
    // fetch reports a zero count; the probe reveals the true total.
    mockGetStorefrontSearchProducts
      .mockResolvedValueOnce({
        count: 0,
        didYouMean: null,
        products: [],
        productIds: [],
        query: 'iphone',
      })
      .mockResolvedValueOnce({
        count: 45,
        didYouMean: null,
        products: createSearchProducts(20),
        productIds: [],
        query: 'iphone',
      });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '5' })
      )) as React.ReactElement
    );

    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(2);
    expect(mockGetStorefrontSearchProducts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ offset: 80 })
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 0 })
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      '/ogabassey/search?q=iphone&page=3'
    );
  });

  it('normalizes an empty out-of-range page to the first page', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts
      .mockResolvedValueOnce({
        count: 0,
        didYouMean: null,
        products: [],
        productIds: [],
        query: 'iphon',
      })
      .mockResolvedValueOnce({
        count: 0,
        didYouMean: 'iphone',
        products: [],
        productIds: [],
        query: 'iphon',
      });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphon', page: '3' })
      )) as React.ReactElement
    );

    // The no-results state renders at the explicit first-page URL (where the
    // probe's did-you-mean suggestion is recomputed) instead of duplicating
    // empty content across unbounded ?page=N variants — and the landing
    // never counts as a fresh submission.
    expect(mockRedirect).toHaveBeenCalledWith(
      '/ogabassey/search?q=iphon&page=1'
    );
  });

  it('caps pagination at the maximum servable page', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 5230,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '100' })
      )) as React.ReactElement
    );

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '100' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      screen.queryByRole('link', { name: /next/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute(
      'href',
      '/ogabassey/search?q=iphone&page=99'
    );
  });

  it('advertises the ranked last page when a first-page row vanished', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 20,
      totalCount: 21,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone' })
      )) as React.ReactElement
    );

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/ogabassey/search?q=iphone&page=2'
    );
  });

  it('bounds deep pages through a last-page redirect', async () => {
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
        createSearchPageProps({ q: 'iphone', page: '101' })
      )) as React.ReactElement
    );

    // No giant-offset query is issued; the single probe stays untracked.
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(1);
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 })
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      '/ogabassey/search?q=iphone&page=3'
    );
  });
});

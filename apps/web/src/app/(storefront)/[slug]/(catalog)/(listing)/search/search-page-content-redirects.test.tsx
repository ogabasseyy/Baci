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

  it('redirects a malformed page to the first page', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValue({
      count: 45,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: 'abc' })
      )) as React.ReactElement
    );

    expect(mockRedirect).toHaveBeenCalledWith(
      '/ogabassey/search?q=iphone&page=1'
    );
  });

  it('redirects a repeated page parameter to the first page', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValue({
      count: 45,
      didYouMean: null,
      products: createSearchProducts(20),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: ['1', '2'] })
      )) as React.ReactElement
    );

    expect(mockRedirect).toHaveBeenCalledWith(
      '/ogabassey/search?q=iphone&page=1'
    );
  });

  it('treats a repeated query as an empty search', async () => {
    mockStorefrontContext();

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: ['iphone', 'galaxy'] })
      )) as React.ReactElement
    );

    expect(getStorefrontSearchProducts).not.toHaveBeenCalled();
    expect(screen.getByText('Start a search')).toBeInTheDocument();
  });

  it('collapses a paged query-less URL to the plain search route', async () => {
    mockStorefrontContext();

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: '', page: '3' })
      )) as React.ReactElement
    );

    expect(mockRedirect).toHaveBeenCalledWith('/ogabassey/search');
    expect(getStorefrontSearchProducts).not.toHaveBeenCalled();
  });
});

import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
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

vi.mock('./search-comparison', () => ({
  SearchCompareButton: () => null,
  SearchComparisonTray: () => <section data-testid="search-comparison-tray" />,
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

  it('shows a no-results state and suggestion when nothing matches', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'proxy.internal'],
        ['x-custom-domain', 'shop.example.ng'],
        ['x-pathname', '/search'],
      ])
    );

    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'shop.example.ng',
      business_name: 'Ogabassey',
      payout_currency: 'NGN',
    } as never);

    vi.mocked(getStorefrontSearchProducts).mockResolvedValue({
      count: 0,
      didYouMean: 'iphone',
      products: [],
      query: 'iphon',
    } as never);

    const result = await SearchPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: 'iphon', page: '1' }),
    });

    render(result as React.ReactElement);

    expect(
      screen.getByText(/No results found for “iphon”/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /No products found/i })
    ).toBeInTheDocument();
    // Single did-you-mean affordance: the clickable suggestion link (no
    // duplicate plain-text "Try searching for" paragraph).
    expect(screen.getByRole('link', { name: /iphone/i })).toBeInTheDocument();
    expect(screen.queryByText(/Try searching for/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/We could not find any products matching “iphon”/i)
    ).toBeInTheDocument();
  });

  it('renders did-you-mean as a search link', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 0,
      didYouMean: 'iphone',
      products: [],
      productIds: [],
      query: 'iphnoe',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphnoe' })
      )) as React.ReactElement
    );

    expect(screen.getByRole('link', { name: /iphone/i })).toHaveAttribute(
      'href',
      '/ogabassey/search?q=iphone'
    );
  });

  it('mounts the comparison tray on empty results so saved selections stay reachable', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 0,
      didYouMean: null,
      products: [],
      productIds: [],
      query: 'phone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'phone' })
      )) as React.ReactElement
    );

    expect(screen.getByTestId('search-comparison-tray')).toBeInTheDocument();
  });

  it('shows recovery actions when a search has no results', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 0,
      didYouMean: null,
      products: [],
      productIds: [],
      query: 'nonexistent quantum gadget',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'nonexistent quantum gadget' })
      )) as React.ReactElement
    );

    expect(
      screen.getByRole('heading', { name: /no products found/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /view all products/i })
    ).toHaveAttribute('href', '/ogabassey/products');
    expect(
      screen.getByRole('link', { name: /contact support/i })
    ).toHaveAttribute('href', '/ogabassey/contact');
  });
});

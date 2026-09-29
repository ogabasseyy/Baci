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

  it('shows the first slice of capped results and request-scoped schema URLs', async () => {
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
      count: 200,
      didYouMean: 'iphone',
      products: createSearchProducts(20),
      query: 'iphone',
    } as never);

    const result = await SearchPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: 'iphone', page: '1' }),
    });

    render(result as React.ReactElement);

    expect(
      screen.getByRole('heading', { name: /Search Results/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Showing first 20 of 200 results for “iphone”/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Did you mean/i, { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.getByText('iPhone 16')).toBeInTheDocument();

    const schemas = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    ).map(
      (script) =>
        JSON.parse(script.textContent || '{}') as {
          '@type'?: string;
          mainEntity?: {
            itemListElement?: Array<{
              item?: { url?: string };
            }>;
          };
        }
    );

    expect(schemas).toHaveLength(2);
    expect(schemas.some((schema) => schema['@type'] === 'BreadcrumbList')).toBe(
      true
    );

    const collectionSchema = schemas.find(
      (schema) => schema['@type'] === 'CollectionPage'
    );
    const breadcrumbSchema = schemas.find(
      (schema) => schema['@type'] === 'BreadcrumbList'
    );

    expect(collectionSchema).toMatchObject({
      '@type': 'CollectionPage',
      url: 'https://shop.example.ng/search?q=iphone',
      numberOfItems: 20,
    });
    expect(collectionSchema?.mainEntity?.itemListElement).toHaveLength(20);
    // Canonical URLs must preserve the stored `category_slug` verbatim.
    // Remapping `phones` -> `smartphones` would cause a self-redirect loop
    // in the product route (see buildProductUrl regression tests).
    expect(collectionSchema?.mainEntity?.itemListElement?.[0]).toMatchObject({
      item: {
        url: 'https://shop.example.ng/phones/iphone-16',
      },
    });

    expect(breadcrumbSchema).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          item: 'https://shop.example.ng/',
        },
        {
          item: 'https://shop.example.ng/search?q=iphone',
        },
      ],
    });
  });

  it('uses the resolved merchant currency for JSON-LD offer pricing', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'proxy.internal'],
        ['x-custom-domain', 'shop.example.gh'],
        ['x-pathname', '/search'],
      ])
    );

    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ghstore',
      custom_domain: 'shop.example.gh',
      business_name: 'Accra Store',
      payout_currency: 'GHS',
      country: 'GH',
    } as never);

    vi.mocked(getStorefrontSearchProducts).mockResolvedValue({
      count: 1,
      didYouMean: null,
      products: [
        {
          id: 'product-1',
          name: 'iPhone 16',
          price: 1200,
          slug: 'iphone-16',
          category: 'Phones',
          category_slug: 'phones',
        },
      ],
      query: 'iphone',
    } as never);

    const result = await SearchPageContent({
      params: Promise.resolve({ slug: 'ghstore' }),
      searchParams: Promise.resolve({ q: 'iphone', page: '1' }),
    });

    render(result as React.ReactElement);

    const schemas = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    ).map(
      (script) =>
        JSON.parse(script.textContent || '{}') as {
          '@type'?: string;
          mainEntity?: {
            itemListElement?: Array<{
              item?: { offers?: { priceCurrency?: string } };
            }>;
          };
        }
    );

    const collectionSchema = schemas.find(
      (schema) => schema['@type'] === 'CollectionPage'
    );

    expect(
      collectionSchema?.mainEntity?.itemListElement?.[0]?.item?.offers
    ).toMatchObject({ priceCurrency: 'GHS' });
  });

  it('does not prepend the merchant slug on subdomain storefront links', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'ogabassey.usebaci.com'],
        ['x-merchant-slug', 'ogabassey'],
        ['x-pathname', '/search'],
      ])
    );

    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: null,
      business_name: 'Ogabassey',
      payout_currency: 'NGN',
    } as never);

    vi.mocked(getStorefrontSearchProducts).mockResolvedValue({
      count: 1,
      didYouMean: null,
      products: [
        {
          id: 'product-1',
          name: 'iPhone 16',
          price: 1200000,
          slug: 'iphone-16',
          category: 'Phones',
          category_slug: 'phones',
        },
      ],
      query: 'iphone',
    } as never);

    const result = await SearchPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: 'iphone', page: '1' }),
    });

    render(result as React.ReactElement);

    expect(screen.getByTestId('path-prefix-iPhone 16')).toBeEmptyDOMElement();
  });

  it('shows a start-search prompt when the query is empty', async () => {
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

    const result = await SearchPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: '', page: '1' }),
    });

    render(result as React.ReactElement);

    expect(
      screen.getByRole('heading', { name: /Search Results/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enter a search term to browse matching products\./i)
    ).toBeInTheDocument();
    expect(getStorefrontSearchProducts).not.toHaveBeenCalled();
    expect(screen.getByText('Start a search')).toBeInTheDocument();
  });

  it('treats a query that sanitizes to empty as an empty search', async () => {
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

    const result = await SearchPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: '< >', page: '1' }),
    });

    render(result as React.ReactElement);

    expect(
      screen.getByText(/Enter a search term to browse matching products\./i)
    ).toBeInTheDocument();
    expect(getStorefrontSearchProducts).not.toHaveBeenCalled();
    expect(screen.getByText('Start a search')).toBeInTheDocument();

    const schemas = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    ).map(
      (script) =>
        JSON.parse(script.textContent || '{}') as {
          '@type'?: string;
        }
    );

    const collectionSchema = schemas.find(
      (schema) => schema['@type'] === 'CollectionPage'
    );
    const breadcrumbSchema = schemas.find(
      (schema) => schema['@type'] === 'BreadcrumbList'
    );

    expect(collectionSchema).toMatchObject({
      '@type': 'CollectionPage',
      url: 'https://shop.example.ng/search',
    });
    expect(breadcrumbSchema).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          item: 'https://shop.example.ng/',
        },
        {
          item: 'https://shop.example.ng/search',
        },
      ],
    });
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
        trackAnalytics: false,
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

  it('records a submission entry without a page param as a new search', async () => {
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
      expect.objectContaining({ offset: 0, trackAnalytics: true })
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
      expect.objectContaining({ offset: 0, trackAnalytics: false })
    );
  });

  it('tracks one submission across a page 1 → 2 → 1 journey', async () => {
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
      expect.objectContaining({ offset: 0, trackAnalytics: true })
    );

    // Paging forward is navigation, not a submission.
    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '2' })
      )) as React.ReactElement
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 20, trackAnalytics: false })
    );

    // Returning to page 1 via the Previous link (explicit page=1) must not
    // recount the original submission.
    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone', page: '1' })
      )) as React.ReactElement
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, trackAnalytics: false })
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(3);
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
      expect.objectContaining({ offset: 80, trackAnalytics: false })
    );
    expect(mockGetStorefrontSearchProducts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 0, trackAnalytics: false })
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
      expect.objectContaining({ offset: 0, trackAnalytics: false })
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      '/ogabassey/search?q=iphone&page=3'
    );
  });

  it('renders a prefilled in-page search form', async () => {
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

    const form = screen.getByRole('form', { name: 'Edit search' });
    expect(form).toHaveAttribute('action', '/ogabassey/search');
    expect(screen.getByLabelText('Search products')).toHaveValue('iphone');
  });

  it('renders the search form against the custom-domain route', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'shop.example.ng'],
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
    mockGetStorefrontSearchProducts.mockResolvedValueOnce({
      count: 1,
      didYouMean: null,
      products: createSearchProducts(1),
      productIds: [],
      query: 'iphone',
    });

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone' })
      )) as React.ReactElement
    );

    expect(screen.getByRole('form', { name: 'Edit search' })).toHaveAttribute(
      'action',
      '/search'
    );
  });

  it('renders a distinct error state when the search fails', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockRejectedValueOnce(
      new Error('search rpc down')
    );

    render(
      (await SearchPageContent(
        createSearchPageProps({ q: 'iphone' })
      )) as React.ReactElement
    );

    expect(
      screen.getByRole('heading', { name: /temporarily unavailable/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /no products found/i })
    ).not.toBeInTheDocument();
    // Retry is a route refresh (re-executes the search), not a link to the
    // identical URL, which would reuse the cached error route.
    expect(
      screen.getByRole('button', { name: /try again/i })
    ).toBeInTheDocument();
    // The submitted query survives the failure for editing and retry.
    expect(screen.getByLabelText('Search products')).toHaveValue('iphone');
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
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

function mockStorefrontContext(slug = 'ogabassey', isPublished = true) {
  mockHeaders.mockResolvedValue(
    new Headers([
      ['host', 'proxy.internal'],
      ['x-pathname', `/${slug}/search`],
    ])
  );

  vi.mocked(getRequestScopedMerchant).mockResolvedValue({
    id: 'merchant-1',
    slug,
    custom_domain: null,
    business_name: slug === 'ogabassey' ? 'Ogabassey' : 'Other store',
    payout_currency: 'NGN',
    is_published: isPublished,
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

  it.each([
    { slug: 'ogabassey', present: true },
    { slug: 'other', present: false },
  ])('advertises search assistance only on the configured tenant ($slug)', async ({
    slug,
    present,
  }) => {
    const prevFlag = process.env.STOREFRONT_SEARCH_ASSIST_ENABLED;
    const prevTenant = process.env.BACI_AGENTIC_MERCHANT_SLUG;
    process.env.STOREFRONT_SEARCH_ASSIST_ENABLED = 'true';
    process.env.BACI_AGENTIC_MERCHANT_SLUG = 'ogabassey';
    try {
      mockStorefrontContext(slug);
      mockGetStorefrontSearchProducts.mockResolvedValueOnce({
        count: 45,
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
      fireEvent.focus(screen.getByLabelText('Search products'));

      if (present) {
        expect(
          screen.getByRole('button', { name: 'Ask about this search' })
        ).toBeInTheDocument();
      } else {
        expect(
          screen.queryByRole('button', { name: 'Ask about this search' })
        ).toBeNull();
      }
    } finally {
      if (prevFlag === undefined)
        delete process.env.STOREFRONT_SEARCH_ASSIST_ENABLED;
      else process.env.STOREFRONT_SEARCH_ASSIST_ENABLED = prevFlag;
      if (prevTenant === undefined)
        delete process.env.BACI_AGENTIC_MERCHANT_SLUG;
      else process.env.BACI_AGENTIC_MERCHANT_SLUG = prevTenant;
    }
  });

  it('hides search assistance on an unpublished configured tenant', async () => {
    const prevFlag = process.env.STOREFRONT_SEARCH_ASSIST_ENABLED;
    const prevTenant = process.env.BACI_AGENTIC_MERCHANT_SLUG;
    process.env.STOREFRONT_SEARCH_ASSIST_ENABLED = 'true';
    process.env.BACI_AGENTIC_MERCHANT_SLUG = 'ogabassey';
    try {
      // The chat resolver rejects unpublished merchants, so advertising the
      // entry point would end every attempt in a 503.
      mockStorefrontContext('ogabassey', false);
      mockGetStorefrontSearchProducts.mockResolvedValueOnce({
        count: 45,
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
      fireEvent.focus(screen.getByLabelText('Search products'));

      expect(
        screen.queryByRole('button', { name: 'Ask about this search' })
      ).toBeNull();
    } finally {
      if (prevFlag === undefined)
        delete process.env.STOREFRONT_SEARCH_ASSIST_ENABLED;
      else process.env.STOREFRONT_SEARCH_ASSIST_ENABLED = prevFlag;
      if (prevTenant === undefined)
        delete process.env.BACI_AGENTIC_MERCHANT_SLUG;
      else process.env.BACI_AGENTIC_MERCHANT_SLUG = prevTenant;
    }
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

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

describe('SearchPageContent', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    mockGetStorefrontSearchProducts.mockReset();
    mockHeaders.mockReset();
    mockRedirect.mockReset();
    mockNotFound.mockReset();
  });

  it('records explicit form and spelling submissions without tracking a render', async () => {
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
    mockGetStorefrontSearchProducts.mockResolvedValue({
      count: 0,
      products: [],
      query: 'iphnoe',
      didYouMean: 'iphone',
    } as never);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      (await SearchPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ q: 'iphnoe' }),
      })) as React.ReactElement
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    expect(input).toHaveValue('iphnoe');
    fireEvent.change(input, { target: { value: 'ipad' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      query: 'ipad',
      pathPrefix: '/ogabassey',
      source: 'results-form',
    });
    const suggestion = screen.getByRole('link', { name: 'iphone' });
    expect(suggestion).toHaveAttribute('href', '/ogabassey/search?q=iphone');
    suggestion.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(suggestion);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      query: 'iphone',
      pathPrefix: '/ogabassey',
      source: 'did-you-mean',
    });
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
});

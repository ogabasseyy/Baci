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

describe('SearchPageContent', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    mockGetStorefrontSearchProducts.mockReset();
    mockHeaders.mockReset();
    mockRedirect.mockReset();
    mockNotFound.mockReset();
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
});

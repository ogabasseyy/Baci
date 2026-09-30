import { render } from '@testing-library/react';
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
});

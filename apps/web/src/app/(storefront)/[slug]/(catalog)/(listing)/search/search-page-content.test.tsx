import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
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
    imagePriority,
  }: {
    pathPrefix: string;
    product: { name: string };
    imagePriority?: boolean;
  }) => (
    <article
      aria-label={product.name}
      data-image-priority={String(Boolean(imagePriority))}
    >
      <span>{product.name}</span>
      <span data-testid={`path-prefix-${product.name}`}>{pathPrefix}</span>
    </article>
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
  it('does not render a duplicate results search on Ogabassey', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'ogabassey.com'],
        ['x-pathname', '/search'],
      ])
    );
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      template_id: 'ogabassey',
      business_name: 'Shop',
      payout_currency: 'NGN',
    } as never);
    mockGetStorefrontSearchProducts.mockResolvedValue({
      count: 1,
      products: createSearchProducts(1),
      query: 'iphone',
    } as never);
    render(
      (await SearchPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ q: 'iphone' }),
      })) as React.ReactElement
    );
    expect(
      screen.queryByRole('form', { name: 'Edit search' })
    ).not.toBeInTheDocument();
  });
  it.each([
    'ogabassey',
    'another-store',
  ])('bounds first-screen image priority for %s', async (slug) => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'shop.example.ng'],
        ['x-pathname', '/search'],
      ])
    );
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug,
      business_name: 'Shop',
      payout_currency: 'NGN',
    } as never);
    mockGetStorefrontSearchProducts.mockResolvedValue({
      count: 3,
      products: createSearchProducts(3),
      query: 'iphone',
    } as never);
    render(
      (await SearchPageContent({
        params: Promise.resolve({ slug }),
        searchParams: Promise.resolve({ q: 'iphone' }),
      })) as React.ReactElement
    );
    const expected = slug === 'ogabassey' ? 'true' : 'false';
    expect(screen.getByRole('article', { name: 'iPhone 16' })).toHaveAttribute(
      'data-image-priority',
      expected
    );
    expect(screen.getByRole('article', { name: 'iPhone 18' })).toHaveAttribute(
      'data-image-priority',
      expected
    );
    expect(screen.getByRole('article', { name: 'iPhone 19' })).toHaveAttribute(
      'data-image-priority',
      'false'
    );
  });
});

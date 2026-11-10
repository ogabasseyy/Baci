vi.mock(
  '@/components/storefront/experience/experience-server-boundary',
  () => ({
    ExperienceServerBoundary: ({
      fallback,
    }: {
      fallback: import('react').ReactNode;
    }) => fallback,
  })
);

import { render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRequestScopedMerchant,
  getStorefrontCategories,
} from '@/lib/cached-data';
import { getCachedStorefrontProductIndex } from '@/lib/cached-storefront-product-index';
import {
  mockCategories,
  mockProductIndex,
  mockStorefrontMerchant,
} from './products-page.test-fixtures';

const { mockProductsPageContent, mockConnection } = vi.hoisted(() => ({
  mockProductsPageContent: vi.fn((_props: unknown) => (
    <div>Products page content</div>
  )),
  mockConnection: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: ({
    fill: _fill,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    // biome-ignore lint/performance/noImgElement: next/image test double
    <img {...props} alt={props.alt ?? ''} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getStorefrontCategories: vi.fn(),
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock('@/lib/cached-storefront-product-index', () => ({
  getCachedStorefrontProductIndex: vi.fn(),
}));

vi.mock('@/lib/routes', () => ({ asRoute: (path: string) => path }));

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({ headers: () => mockHeaders() }));

const toStoreUrl = (m: { slug: string; custom_domain?: string | null }) =>
  m.custom_domain
    ? `https://${m.custom_domain}`
    : `https://${m.slug}.usebaci.com`;

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: toStoreUrl,
  buildRequestScopedStoreUrl: toStoreUrl,
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (v: string) => v.includes('.'),
  isValidMerchantIdentifier: (v: string) => v !== 'images' && v !== 'product',
}));

vi.mock('./products-page-content', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./products-page-content')>();
  return {
    ...actual,
    ProductsPageContent: (props: unknown) => mockProductsPageContent(props),
  };
});

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('next/server', () => ({ connection: () => mockConnection() }));

const { default: ProductsPage } = await import('./page');
const actualProductsPageContentModule = await vi.importActual<
  typeof import('./products-page-content')
>('./products-page-content');

const renderProductsPageContent = async (
  page = '1',
  slug = 'test-store',
  searchParams: Record<string, string> = { page }
) =>
  render(
    await actualProductsPageContentModule.ProductsPageContent({
      params: Promise.resolve({ slug }),
      searchParams: Promise.resolve(searchParams),
    })
  );

describe('products index page', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getStorefrontCategories).mockReset();
    vi.mocked(getCachedStorefrontProductIndex).mockReset();
    mockProductsPageContent
      .mockReset()
      .mockImplementation(() => <div>Products page content</div>);
    notFound.mockClear();
    mockConnection.mockReset();
    mockHeaders.mockReset().mockResolvedValue(new Headers());
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      mockStorefrontMerchant
    );
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValue(
      mockProductIndex
    );
    vi.mocked(getStorefrontCategories).mockResolvedValue({
      categories: mockCategories,
      queryFailed: false,
    });
  });

  it('renders product and category links for crawlable discovery', async () => {
    await renderProductsPageContent('2');

    expect(
      screen.getByRole('heading', { name: 'Products' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/test-store/smartphones'
    );
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    const [iphoneLink] = screen.getAllByRole('link', { name: /iphone 16/i });
    expect(iphoneLink).toHaveAttribute(
      'href',
      '/test-store/smartphones/iphone-16'
    );
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/test-store/products'
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
  });

  it('renders the first page without a previous pagination link', async () => {
    await renderProductsPageContent('1');

    expect(
      screen.getByRole('heading', { name: 'Products' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/test-store/smartphones'
    );
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    const [iphoneLink] = screen.getAllByRole('link', { name: /iphone 16/i });
    expect(iphoneLink).toHaveAttribute(
      'href',
      '/test-store/smartphones/iphone-16'
    );
    expect(
      screen.queryByRole('link', { name: 'Previous' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Store description')).toBeInTheDocument();
  });

  it('does not prepend the merchant slug on subdomain storefront links', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-merchant-slug', 'test-store']])
    );

    await renderProductsPageContent('2');

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/'
    );
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/smartphones'
    );
    const [iphoneLink] = screen.getAllByRole('link', { name: /iphone 16/i });
    expect(iphoneLink).toHaveAttribute('href', '/smartphones/iphone-16');
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/products'
    );
  });

  it('calls notFound when the merchant is missing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(null);

    await expect(
      renderProductsPageContent('1', 'missing-store', {})
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
  });

  it('calls notFound when the slug is invalid before lookup', async () => {
    await expect(renderProductsPageContent('1', 'images', {})).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );

    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
  });

  it('does not return notFound for paginated product pages when the index fetch fails', async () => {
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValueOnce({
      hasError: true,
      products: [],
      totalCount: 0,
      totalPages: 0,
    });

    await expect(renderProductsPageContent('2')).resolves.toBeDefined();

    expect(notFound).not.toHaveBeenCalled();
  });

  it('renders the catalog skeleton while products content is suspended', () => {
    mockProductsPageContent.mockImplementation(() => {
      throw new Promise(() => {});
    });

    const ui = ProductsPage({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({}),
    });

    render(
      <Suspense fallback={<div>Route loader fallback</div>}>{ui}</Suspense>
    );

    expect(
      screen.getByRole('status', { name: 'Loading product listing' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Route loader fallback')).not.toBeInTheDocument();
    expect(screen.queryByText('Products page content')).not.toBeInTheDocument();
    expect(mockConnection).toHaveBeenCalledOnce();
  });

  it('keeps product listings request-bound behind a static-shell fallback', async () => {
    render(
      ProductsPage({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('status', { name: 'Loading product listing' })
    ).toBeInTheDocument();
    await waitFor(() => expect(mockConnection).toHaveBeenCalledOnce());
  });

  it('renders a placeholder when a catalog item is missing an image', async () => {
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValueOnce({
      ...mockProductIndex,
      products: [
        {
          ...mockProductIndex.products[0],
          image: '',
        },
      ],
    });

    await renderProductsPageContent('1');

    expect(
      screen.getByLabelText('No image available for iPhone 16')
    ).toBeInTheDocument();
  });
});

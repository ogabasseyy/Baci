import { render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedCategories,
  getRequestScopedMerchant,
} from '@/lib/cached-data';
import { getCachedStorefrontProductIndex } from '@/lib/cached-storefront-product-index';

const { mockProductsPageContent } = vi.hoisted(() => ({
  mockProductsPageContent: vi.fn((_props: unknown) => (
    <div>Products page content</div>
  )),
}));
const mockConnection = vi.hoisted(() => vi.fn());

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

vi.mock('@/lib/cached-data', () => {
  const getCachedCategories = vi.fn();

  return {
    getCachedCategories,
    getStorefrontCategories: async (...args: unknown[]) => ({
      categories: await getCachedCategories(...args),
      queryFailed: false,
    }),
    getRequestScopedMerchant: vi.fn(),
  };
});

vi.mock('@/lib/cached-storefront-product-index', () => ({
  getCachedStorefrontProductIndex: vi.fn(),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn(() => '{}'),
}));

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { slug: string; custom_domain?: string | null }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
  buildRequestScopedStoreUrl: (
    merchant: { slug: string; custom_domain?: string | null },
    _headers: Headers
  ) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
  isValidMerchantIdentifier: (value: string) =>
    value !== 'images' &&
    value !== 'product' &&
    (value.includes('.') ||
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(value)),
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

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

const merchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  slug: 'test-store',
  custom_domain: null,
  payout_currency: 'NGN',
  site_description: 'Store description',
};

const productIndex = {
  hasError: false,
  products: [
    {
      id: 'product-1',
      name: 'iPhone 16',
      slug: 'iphone-16',
      description: 'Phone description',
      image: 'https://cdn.example.com/iphone-16.png',
      imageLarge: 'https://cdn.example.com/iphone-16.png',
      images: ['https://cdn.example.com/iphone-16.png'],
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 1200000,
      compare_at_price: null,
      condition: 'new',
      stock: 5,
      rating: 0,
      availability: 'InStock' as const,
      available_conditions: [],
      variant_model: 'legacy' as const,
    },
  ],
  totalCount: 21,
  totalPages: 2,
};

const { default: ProductsPage, generateMetadata } = await import('./page');
const actualProductsPageContentModule = await vi.importActual<
  typeof import('./products-page-content')
>('./products-page-content');

describe('products index page', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getCachedCategories).mockReset();
    vi.mocked(getCachedStorefrontProductIndex).mockReset();
    mockProductsPageContent.mockReset();
    mockProductsPageContent.mockImplementation(() => (
      <div>Products page content</div>
    ));
    notFound.mockClear();

    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      merchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    mockHeaders.mockReset();
    mockHeaders.mockResolvedValue(new Headers());
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValue(productIndex);
    vi.mocked(getCachedCategories).mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Smartphones',
        slug: 'smartphones',
        description: null,
        image_url: null,
        is_active: true,
        parent_id: null,
      },
    ]);
    mockConnection.mockReset();
  });

  it('renders product and category links for crawlable discovery', async () => {
    render(
      await actualProductsPageContentModule.ProductsPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );

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
    const iphoneLinks = screen.getAllByRole('link', { name: /iphone 16/i });
    expect(iphoneLinks).toHaveLength(2);
    for (const link of iphoneLinks) {
      expect(link).toHaveAttribute('href', '/test-store/smartphones/iphone-16');
    }
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
    render(
      await actualProductsPageContentModule.ProductsPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

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
    const iphoneLinks = screen.getAllByRole('link', { name: /iphone 16/i });
    expect(iphoneLinks).toHaveLength(1);
    for (const link of iphoneLinks) {
      expect(link).toHaveAttribute('href', '/test-store/smartphones/iphone-16');
    }
    expect(
      screen.queryByRole('link', { name: 'Previous' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Store description')).toBeInTheDocument();
  });

  it('does not prepend the merchant slug on subdomain storefront links', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-merchant-slug', 'test-store']])
    );

    render(
      await actualProductsPageContentModule.ProductsPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/'
    );
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/smartphones'
    );
    const iphoneLinks = screen.getAllByRole('link', { name: /iphone 16/i });
    expect(iphoneLinks).toHaveLength(2);
    for (const link of iphoneLinks) {
      expect(link).toHaveAttribute('href', '/smartphones/iphone-16');
    }
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/products'
    );
  });

  it('calls notFound when the merchant is missing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(null);

    await expect(
      actualProductsPageContentModule.ProductsPageContent({
        params: Promise.resolve({ slug: 'missing-store' }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
  });

  it('calls notFound when the slug is invalid before lookup', async () => {
    await expect(
      actualProductsPageContentModule.ProductsPageContent({
        params: Promise.resolve({ slug: 'images' }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
  });

  it('returns noindex metadata for invalid metadata pagination without lookup', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ page: '0' }),
    });

    expect(metadata).toMatchObject({
      title: 'Products page not found',
      description: 'This products page is unavailable or has moved.',
      alternates: null,
      robots: {
        index: false,
        follow: true,
      },
    });
    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('does not return notFound for paginated product pages when the index fetch fails', async () => {
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValueOnce({
      hasError: true,
      products: [],
      totalCount: 0,
      totalPages: 0,
    });

    await expect(
      actualProductsPageContentModule.ProductsPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    ).resolves.toBeDefined();

    expect(notFound).not.toHaveBeenCalled();
  });

  it('renders the catalog skeleton while products content is suspended', () => {
    mockProductsPageContent.mockImplementation(() => {
      throw new Promise(() => {
        // Keep the page content suspended behind the page fallback.
      });
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

  it('uses page-specific product index metadata for paginated listings', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/products?page=2'
    );
    expect(metadata.openGraph?.url).toBe(
      'https://test-store.usebaci.com/products?page=2'
    );
    expect(metadata.robots).toMatchObject({
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    });
    expect(metadata.title).toEqual({
      absolute: 'Products | Page 2 | Ogabassey',
    });
    expect(metadata.description).toContain('Page 2 of 2');
    expect(metadata.openGraph?.description).toContain('Page 2 of 2');
    expect(metadata.twitter?.description).toContain('Page 2 of 2');
    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://cdn.example.com/iphone-16.png',
        alt: 'iPhone 16',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://cdn.example.com/iphone-16.png',
    ]);
    expect(getCachedStorefrontProductIndex).toHaveBeenCalledWith('merchant-1', {
      page: 2,
      limit: 20,
    });
  });

  it('drops focused storefront filters from canonical metadata until listing results are filtered', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ brand: 'Apple', page: '2' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/products?page=2'
    );
    expect(metadata.openGraph?.url).toBe(
      'https://test-store.usebaci.com/products?page=2'
    );
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('noindexes toxic search query listing URLs while keeping the clean products canonical', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ q: 'acc6.top pembelian Shopee akun' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/products'
    );
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: {
        index: false,
        follow: true,
      },
    });
  });

  it('drops price bounds from canonical listing metadata until listing results are filtered', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({
        minPrice: '100000',
        maxPrice: '500000',
      }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/products'
    );
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('drops multi-filter params from canonical listing metadata', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({
        brand: 'Apple',
        minPrice: '100000',
      }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/products'
    );
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('omits ?page=1 from the first-page canonical URL', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/products'
    );
  });

  it('returns noindex metadata for out-of-range metadata pages', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ page: '3' }),
    });

    expect(metadata).toMatchObject({
      title: 'Products page not found',
      description: 'This products page is unavailable or has moved.',
      alternates: null,
      robots: {
        index: false,
        follow: true,
      },
      openGraph: {
        title: 'Products page not found',
        description: 'This products page is unavailable or has moved.',
      },
      twitter: {
        card: 'summary',
        title: 'Products page not found',
        description: 'This products page is unavailable or has moved.',
      },
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('falls back to the storefront opengraph image when catalog items have no media', async () => {
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValueOnce({
      ...productIndex,
      products: [
        {
          ...productIndex.products[0],
          name: 'Untitled Product',
          image: '',
          imageLarge: '',
        },
      ],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://test-store.usebaci.com/opengraph-image',
        alt: 'Untitled Product',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://test-store.usebaci.com/opengraph-image',
    ]);
  });

  it('renders a placeholder when a catalog item is missing an image', async () => {
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValueOnce({
      ...productIndex,
      products: [
        {
          ...productIndex.products[0],
          image: '',
        },
      ],
    });

    render(
      await actualProductsPageContentModule.ProductsPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

    expect(
      screen.getByLabelText('No image available for iPhone 16')
    ).toBeInTheDocument();
  });
});

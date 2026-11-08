import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { getCachedStorefrontProductIndex } from '@/lib/cached-storefront-product-index';
import { mockMerchant, mockProductIndex } from './products-page.test-fixtures';

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
  getCachedCategories: vi.fn(),
  getStorefrontCategories: vi.fn(),
}));

vi.mock('@/lib/cached-storefront-product-index', () => ({
  getCachedStorefrontProductIndex: vi.fn(),
}));

const formatStoreUrl = (m: { slug: string; custom_domain?: string | null }) =>
  m.custom_domain
    ? `https://${m.custom_domain}`
    : `https://${m.slug}.usebaci.com`;

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: formatStoreUrl,
  buildRequestScopedStoreUrl: formatStoreUrl,
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
  isValidMerchantIdentifier: (value: string) =>
    value !== 'images' &&
    value !== 'product' &&
    (value.includes('.') ||
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(value)),
}));

vi.mock('./products-page-content', () => ({
  ProductsPageContent: () => null,
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { generateMetadata } = await import('./page');

describe('products index page metadata', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(getCachedStorefrontProductIndex).mockReset();
    notFound.mockClear();

    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      mockMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );
    vi.mocked(getCachedStorefrontProductIndex).mockResolvedValue(
      mockProductIndex
    );
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

  it.each([
    { category: 'Smartphones' },
    { categories: 'Smartphones' },
  ])('noindexes category query permutations (%j) and canonicalizes to clean /products', async (searchParams) => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve(searchParams),
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
      ...mockProductIndex,
      products: [
        {
          ...mockProductIndex.products[0],
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
});

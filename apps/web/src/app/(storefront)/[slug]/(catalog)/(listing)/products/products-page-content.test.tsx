import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOREFRONT_CRAWL_DISCOVERY_PRODUCT_PAGE_LIMIT } from '@/lib/storefront-pagination';

const {
  mockGenerateBreadcrumbSchema,
  mockGenerateCollectionPageSchema,
  mockGetCachedCategories,
  mockGetCachedStorefrontProductIndex,
  mockGetRequestScopedMerchant,
  mockHeaders,
  mockStorefrontPagination,
} = vi.hoisted(() => ({
  mockGenerateBreadcrumbSchema: vi.fn(() => ({})),
  mockGenerateCollectionPageSchema: vi.fn(() => ({})),
  mockGetCachedCategories: vi.fn(),
  mockGetCachedStorefrontProductIndex: vi.fn(),
  mockGetRequestScopedMerchant: vi.fn(),
  mockHeaders: vi.fn(),
  mockStorefrontPagination: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock(
  '@/components/storefront/ogabassey/components/StorefrontPagination',
  () => ({
    StorefrontPagination: (props: Record<string, unknown>) =>
      mockStorefrontPagination(props),
  })
);

vi.mock('@/lib/cached-data', () => ({
  getCachedCategories: (...args: unknown[]) => mockGetCachedCategories(...args),
  getStorefrontCategories: async (...args: unknown[]) => {
    try {
      return {
        categories: await mockGetCachedCategories(...args),
        queryFailed: false,
      };
    } catch {
      return { categories: [], queryFailed: true };
    }
  },
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
}));

vi.mock('@/lib/cached-storefront-product-index', () => ({
  getCachedStorefrontProductIndex: (...args: unknown[]) =>
    mockGetCachedStorefrontProductIndex(...args),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => null,
}));

vi.mock('@/lib/seo-utils', () => ({
  generateBreadcrumbSchema: mockGenerateBreadcrumbSchema,
  generateCollectionPageSchema: mockGenerateCollectionPageSchema,
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://store.example.com',
}));

vi.mock('@/lib/validation', () => ({
  isValidMerchantIdentifier: () => true,
}));

vi.mock('./product-index-card', () => ({
  ProductIndexCard: ({
    formattedPrice,
    product,
  }: {
    formattedPrice: string;
    product: { name: string };
  }) => (
    <article>
      <h2>{product.name}</h2>
      <span>{formattedPrice}</span>
    </article>
  ),
}));

const { ProductsPageContent } = await import('./products-page-content');

describe('ProductsPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetCachedCategories.mockResolvedValue([]);
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      products: [],
      totalCount: 0,
      totalPages: 1,
    });
  });

  it('passes the merchant payout currency into collection schema generation', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'GH',
      payout_currency: 'GHS',
      site_description: 'Browse products',
    });

    await ProductsPageContent({
      params: Promise.resolve({ slug: 'demo-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'GHS' })
    );
  });

  it('preserves distinct merchant-defined category slugs without alias remapping', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
      site_description: 'Browse products',
    });
    mockGetCachedCategories.mockResolvedValue([
      // Prior to the fix, both `samsung` and `phones` were remapped to
      // `smartphones` and deduped into a single entry, hiding the Samsung
      // category link. After the fix, each stored slug should stand on its
      // own.
      { id: 'cat-samsung', name: 'Samsung', slug: 'samsung' },
      { id: 'cat-phones', name: 'Phones', slug: 'phones' },
      { id: 'cat-smartphones', name: 'Smartphones', slug: 'smartphones' },
      { id: 'cat-macbook', name: 'Macbook', slug: 'macbook' },
      { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' },
      // Pure case/whitespace duplicate — should still collapse.
      { id: 'cat-laptops-dup', name: 'Laptops (dup)', slug: ' Laptops ' },
    ]);

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'demo-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(result as React.ReactElement);

    // Each merchant-defined distinct slug should render its own link. Assert
    // against the actual rendered anchors so we don't couple to React element
    // internals or `JSON.stringify` shape.
    expect(screen.getByRole('link', { name: 'Samsung' })).toHaveAttribute(
      'href',
      '/demo-store/samsung'
    );
    expect(screen.getByRole('link', { name: 'Phones' })).toHaveAttribute(
      'href',
      '/demo-store/phones'
    );
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/demo-store/smartphones'
    );
    expect(screen.getByRole('link', { name: 'Macbook' })).toHaveAttribute(
      'href',
      '/demo-store/macbook'
    );

    // Pure case/whitespace duplicates should still collapse — exactly one
    // "Laptops*" link should render, pointing at the canonical lowercased
    // slug and never the raw ` Laptops ` variant.
    const laptopLinks = screen.getAllByRole('link', {
      name: /^Laptops/,
    });
    expect(laptopLinks).toHaveLength(1);
    expect(laptopLinks[0]).toHaveAttribute('href', '/demo-store/laptops');
  });

  it("falls back to 'NGN' when merchant payout currency is missing", async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: null,
      payout_currency: null,
      site_description: 'Browse products',
    });

    await ProductsPageContent({
      params: Promise.resolve({ slug: 'demo-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'NGN' })
    );
  });

  it('renders product cards with the merchant payout currency', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'IN',
      payout_currency: 'INR',
      site_description: 'Browse products',
    });
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 1,
      totalPages: 1,
      products: [
        {
          id: 'product-1',
          name: 'Kurta Set',
          slug: 'kurta-set',
          price: 2500,
          images: [],
          categories: [{ name: 'Fashion', slug: 'fashion' }],
        },
      ],
    });

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'demo-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(result as React.ReactElement);

    expect(screen.getByText(/₹|INR/)).toBeInTheDocument();
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
  });

  it('keeps rendering products when optional category navigation is unavailable', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
      site_description: 'Browse products',
    });
    mockGetCachedCategories.mockRejectedValueOnce(
      new Error('category timeout')
    );
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 1,
      totalPages: 1,
      products: [
        {
          id: 'product-1',
          name: 'Galaxy S25',
          slug: 'galaxy-s25',
          price: 1_000_000,
          images: [],
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
    });

    render(
      (await ProductsPageContent({
        params: Promise.resolve({ slug: 'demo-store' }),
        searchParams: Promise.resolve({ page: '1' }),
      })) as React.ReactElement
    );

    expect(
      screen.getByRole('heading', { name: 'Galaxy S25' })
    ).toBeInTheDocument();
  });

  it('enables crawl discovery pagination for the product index', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
      site_description: 'Browse products',
    });
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 1280,
      totalPages: 64,
      products: [
        {
          id: 'product-1',
          name: 'Galaxy S25',
          slug: 'galaxy-s25',
          price: 2500,
          images: [],
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
    });

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'demo-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(result as React.ReactElement);

    expect(mockStorefrontPagination).toHaveBeenCalledWith(
      expect.objectContaining({
        ariaLabel: 'Products pagination',
        basePath: '/demo-store/products',
        crawlDiscoveryAllPagesThreshold:
          STOREFRONT_CRAWL_DISCOVERY_PRODUCT_PAGE_LIMIT,
        crawlDiscoveryLabel: 'Browse product index pages',
        crawlDiscoveryPageLabel: 'Products page',
        currentPage: 1,
        totalPages: 64,
      })
    );
  });

  it('omits Popular Product Links on page 1 to prevent duplication of current grid items', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
      site_description: 'Browse products',
    });
    mockGetCachedStorefrontProductIndex.mockResolvedValue({
      hasError: false,
      totalCount: 40,
      totalPages: 2,
      products: [
        {
          id: 'prod-1',
          name: 'Galaxy S25',
          slug: 'galaxy-s25',
          price: 2500,
          images: [],
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
    });

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'demo-store' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(result as React.ReactElement);

    expect(
      screen.queryByRole('heading', { name: 'Popular Product Links' })
    ).not.toBeInTheDocument();
  });

  it('renders Popular Product Links on page 2+ linking to top products', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
      site_description: 'Browse products',
    });
    mockGetCachedStorefrontProductIndex.mockImplementation(
      (_merchantId, options: { page?: number } | number) => {
        const page =
          typeof options === 'object' && options !== null
            ? options.page
            : options;
        if (page === 1) {
          return Promise.resolve({
            hasError: false,
            totalCount: 40,
            totalPages: 2,
            products: [
              {
                id: 'prod-page1',
                name: 'First Page Product',
                slug: 'first-page-product',
                price: 2500,
                images: [],
                category_slug: 'smartphones',
              },
            ],
          });
        }
        return Promise.resolve({
          hasError: false,
          totalCount: 40,
          totalPages: 2,
          products: [
            {
              id: 'prod-page2',
              name: 'Second Page Product',
              slug: 'second-page-product',
              price: 3000,
              images: [],
              category_slug: 'smartphones',
            },
          ],
        });
      }
    );

    const result = await ProductsPageContent({
      params: Promise.resolve({ slug: 'demo-store' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    render(result as React.ReactElement);

    expect(
      screen.getByRole('heading', { name: 'Popular Product Links' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'First Page Product' })
    ).toHaveAttribute('href', '/demo-store/smartphones/first-page-product');
  });
});

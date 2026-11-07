import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from '@/config/storefront-metadata-cache-bots';

const {
  mockConnection,
  mockNormalizeStorefrontProductVariants,
  mockProductDetailClient,
} = vi.hoisted(() => ({
  mockConnection: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  mockNormalizeStorefrontProductVariants: vi.fn<
    (...args: unknown[]) => Record<string, unknown>[]
  >(() => []),
  mockProductDetailClient: vi.fn(() => null),
}));

const mockHeaders = vi.fn();
const mockPermanentRedirect = vi.fn((_url: string) => {
  throw new Error('NEXT_REDIRECT');
});
const mockRedirect = vi.fn((_url: string) => {
  throw new Error('NEXT_REDIRECT');
});
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mockGetRequestScopedMerchant = vi.fn();
const mockGetCachedLegacyProductRedirectTarget = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();
const mockGetCachedProductRatingStats = vi.fn();
const mockGetCachedProductReviews = vi.fn();
const mockGetCachedCategoryPageData = vi.fn();
const mockLoadCategoryScopedSemanticInventory = vi.fn();
const mockBuildProductSemanticModel = vi.fn();
const mockGetPublishedClusterPosts = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => mockPermanentRedirect(url),
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
  getCachedLegacyProductRedirectTarget: (...args: unknown[]) =>
    mockGetCachedLegacyProductRedirectTarget(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
  getCachedProductRatingStats: (...args: unknown[]) =>
    mockGetCachedProductRatingStats(...args),
  getCachedProductReviews: (...args: unknown[]) =>
    mockGetCachedProductReviews(...args),
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
  sanitizeLookupLogValue: (value: unknown) =>
    String(value ?? '')
      .replace(/[\r\n\t]/g, '')
      .substring(0, 100),
}));

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({
    loadCategoryScopedSemanticInventorySafely: (...args: unknown[]) =>
      mockLoadCategoryScopedSemanticInventory(...args),
  })
);

vi.mock('@/lib/storefront-product/build-product-semantic-model', () => ({
  buildProductSemanticModel: (...args: unknown[]) =>
    mockBuildProductSemanticModel(...args),
}));

vi.mock('@/lib/storefront-content/get-published-cluster-posts', () => ({
  getPublishedClusterPosts: (...args: unknown[]) =>
    mockGetPublishedClusterPosts(...args),
}));

vi.mock('@/lib/sanitize-core', () => ({
  escapeHtml: (v: string) => v,
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: () => '{}',
}));

const mockGenerateBreadcrumbSchema = vi.fn((_items: unknown) => ({}));
const mockGenerateProductSchema = vi.fn((..._args: unknown[]) => ({
  offers: {} as Record<string, unknown>,
}));
const mockBuildStorefrontAcceptedPaymentMethods = vi.fn<
  (...args: unknown[]) => string[]
>(() => ['Bank transfer']);
type ProductUrlInput = {
  id: string;
  slug?: string;
  category?: string | null;
  categories?: { slug?: string } | null;
  category_slug?: string;
  canonical_url?: string | null;
};
const defaultGetProductUrl = (product: ProductUrlInput) => {
  const productSlug = product.slug ?? product.id;
  const categorySlug =
    product.categories?.slug ||
    product.category_slug ||
    (product.category
      ? product.category.toLowerCase().replace(/\s+/g, '-')
      : undefined);

  return categorySlug
    ? `/${categorySlug}/${productSlug}`
    : `/products/${productSlug}`;
};
const mockGetProductUrl = vi.fn((product: ProductUrlInput) =>
  defaultGetProductUrl(product)
);
const defaultGetValidatedProductUrl = (
  product: ProductUrlInput,
  baseUrl: string,
  _merchantSlug?: string | null
) => `${baseUrl}${mockGetProductUrl({ ...product, canonical_url: null })}`;
const mockGetValidatedProductUrl = vi.fn(defaultGetValidatedProductUrl);

vi.mock('@/lib/seo-utils', () => ({
  buildStorefrontAcceptedPaymentMethods: (...args: unknown[]) =>
    mockBuildStorefrontAcceptedPaymentMethods(...args),
  constructCanonicalUrl: (base: string) => base,
  generateAggregateRating: () => null,
  generateBreadcrumbSchema: (items: unknown) =>
    mockGenerateBreadcrumbSchema(items),
  generateMetaTitle: (title: string, options?: { suffix?: string }) =>
    options?.suffix ? `${title} | ${options.suffix}` : title,
  generateMetaDescription: (description: string, maxLength = 160) => {
    const plainText = description.replace(/<[^>]+>/g, '').trim();
    return plainText.length <= maxLength
      ? plainText
      : `${plainText.slice(0, maxLength - 3)}...`;
  },
  generateFAQSchema: () => ({}),
  generateProductSchema: (...args: unknown[]) =>
    mockGenerateProductSchema(...args),
  generateSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
  getIndexableRobotsMetadata: () => ({
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  }),
  getProductUrl: (product: ProductUrlInput) => mockGetProductUrl(product),
  getValidatedProductUrl: (
    product: ProductUrlInput,
    baseUrl: string,
    merchantSlug?: string | null
  ) => mockGetValidatedProductUrl(product, baseUrl, merchantSlug),
}));

vi.mock('@/lib/korapay', () => ({
  isKorapayConfigured: () => true,
}));

vi.mock('@/lib/paystack', () => ({
  isPaystackConfigured: () => true,
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (m: { slug: string; custom_domain?: string }) =>
    m.custom_domain
      ? `https://${m.custom_domain}`
      : `https://${m.slug}.usebaci.com`,
  // Mirror real `buildRequestScopedStoreUrl` semantics: the x-custom-domain
  // header is only trusted when it matches the merchant's configured custom
  // domain. Otherwise fall back through x-forwarded-host → host → the
  // canonical merchant URL. This prevents future regressions where an
  // untrusted header gets echoed into canonical URLs.
  buildRequestScopedStoreUrl: (
    merchant: { slug: string; custom_domain?: string },
    headers: Headers
  ) => {
    const headerDomain = headers.get('x-custom-domain')?.toLowerCase();
    const merchantDomain = merchant.custom_domain?.toLowerCase();
    if (headerDomain && merchantDomain && headerDomain === merchantDomain) {
      return `https://${merchant.custom_domain}`;
    }

    const forwardedHost = headers.get('x-forwarded-host');
    if (forwardedHost) {
      return `https://${forwardedHost}`;
    }

    const host = headers.get('host');
    if (host) {
      return `https://${host}`;
    }

    return merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`;
  },
}));

vi.mock('@/lib/storefront-product-variants', () => ({
  normalizeStorefrontProductVariants: mockNormalizeStorefrontProductVariants,
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (v: string) => v.includes('.'),
  isValidMerchantIdentifier: () => true,
}));

vi.mock('./product-detail-client', () => ({
  default: () => mockProductDetailClient(),
}));

import ProductPage, { generateMetadata } from './page';
import { resolveProductPage } from './product-page-resolution';
import { ProductPageRuntime } from './product-page-runtime';

const stubParent = Promise.resolve({}) as never;

const baseMerchant = {
  id: 'merchant-1',
  business_name: 'TestStore',
  slug: 'teststore',
  logo_url: null,
  payout_currency: 'NGN',
  country: 'NG',
};

const categorizedDetailedProduct = {
  id: 'prod-1',
  merchant_id: 'merchant-1',
  name: 'iPhone 15',
  slug: 'iphone-15',
  description: 'A phone',
  status: 'active',
  price: 500000,
  compare_at_price: null,
  manage_stock: false,
  stock: 10,
  stock_quantity: 10,
  images: [],
  imageHint: null,
  brand: null,
  gtin: null,
  mpn: null,
  category: 'Phones',
  categories: { id: 'cat-1', name: 'Phones', slug: 'phones', parent_id: null },
  product_variants: [],
  specifications: null,
  product_key_specs: null,
};

const categorizedProduct = categorizedDetailedProduct;

const uncategorizedDetailedProduct = {
  ...categorizedDetailedProduct,
  id: 'prod-2',
  name: 'Mystery Item',
  slug: 'mystery-item',
  category: undefined,
  categories: null,
};

const uncategorizedProduct = uncategorizedDetailedProduct;

function makeHeaders(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    has: (key: string) => map.has(key),
    get: (key: string) => map.get(key) ?? null,
  };
}

describe('products/[productSlug] page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
    mockProductDetailClient.mockReset();
    mockProductDetailClient.mockReturnValue(null);
    mockConnection.mockReset();
    mockConnection.mockResolvedValue(undefined);
    mockHeaders.mockReset();
    mockHeaders.mockReturnValue(makeHeaders({}));
    mockGenerateProductSchema.mockImplementation(() => ({ offers: {} }));
    mockBuildStorefrontAcceptedPaymentMethods.mockReset();
    mockBuildStorefrontAcceptedPaymentMethods.mockReturnValue([
      'Bank transfer',
    ]);
    mockGetProductUrl.mockImplementation(defaultGetProductUrl);
    mockGetValidatedProductUrl.mockImplementation(
      defaultGetValidatedProductUrl
    );
    mockNormalizeStorefrontProductVariants.mockReset();
    mockNormalizeStorefrontProductVariants.mockReturnValue([]);
    mockGetRequestScopedMerchant.mockResolvedValue(baseMerchant);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductRatingStats.mockResolvedValue(null);
    mockGetCachedProductReviews.mockResolvedValue([]);
    mockGetCachedCategoryPageData.mockReset();
    mockGetCachedCategoryPageData.mockResolvedValue(null);
    mockLoadCategoryScopedSemanticInventory.mockReset();
    mockLoadCategoryScopedSemanticInventory.mockResolvedValue({
      isCollection: false,
      categoryName: 'Products',
      products: [],
    });
    mockGetPublishedClusterPosts.mockReset();
    mockGetPublishedClusterPosts.mockResolvedValue([]);
    mockBuildProductSemanticModel.mockReset();
    mockBuildProductSemanticModel.mockReturnValue({
      trustBullets: [],
      supportLinks: [],
      guideLinks: [],
      alternatives: null,
      sameBrand: null,
      samePrice: null,
    });
  });

  it('redirects categorized legacy products after the request boundary in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetCachedProductWithDetails.mockResolvedValue(categorizedProduct);
    mockHeaders.mockReturnValue(makeHeaders({}));

    await expect(
      resolveProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'iphone-15',
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      '/teststore/phones/iphone-15'
    );
  });

  it('redirects categorized products to the category URL when the cached product has a stale products canonical', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...categorizedProduct,
      canonical_url: '/products/iphone-15',
    });
    mockHeaders.mockReturnValue(makeHeaders({}));
    mockGetProductUrl.mockImplementation((product) => {
      if (product.canonical_url) {
        return new URL(product.canonical_url, 'https://storefront.invalid')
          .pathname;
      }

      return defaultGetProductUrl(product);
    });

    await expect(
      resolveProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'iphone-15',
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockPermanentRedirect).toHaveBeenCalledWith('/phones/iphone-15');
  });

  it('defers generic PDP first paint to the route loader while the client page is pending', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);
    mockConnection.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep request-bound PDP work suspended behind the route shell.
        })
    );
    mockProductDetailClient.mockImplementation(() => {
      throw new Promise(() => {
        // Keep the detail client suspended after route data resolves.
      });
    });

    const page = await ProductPage({
      params: Promise.resolve({
        slug: 'teststore',
        productSlug: 'mystery-item',
      }),
      searchParams: Promise.resolve({}),
    });

    render(page);

    expect(
      screen.getByRole('status', { name: 'Loading product page' })
    ).toBeInTheDocument();
    expect(screen.queryByText('mystery-item')).not.toBeInTheDocument();
    expect(mockConnection).toHaveBeenCalledOnce();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('keeps product metadata cacheable without request binding', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);

    await generateMetadata(
      {
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve({}),
      },
      stubParent
    );

    expect(mockConnection).not.toHaveBeenCalled();
    expect(mockGetRequestScopedMerchant).toHaveBeenCalled();
  });

  describe('redirect routing mode', () => {
    it('returns noindex metadata in development for categorized URLs (real redirect happens during page render)', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      mockGetCachedProductWithDetails.mockResolvedValue(categorizedProduct);
      mockHeaders.mockReturnValue(makeHeaders({}));

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'iphone-15',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      expect(metadata.robots).toMatchObject({ index: false, follow: true });
      expect(metadata.alternates).toBeNull();
      expect(mockPermanentRedirect).not.toHaveBeenCalled();
    });

    it('returns noindex metadata in production for categorized URLs (real redirect happens during page render)', async () => {
      mockGetCachedProductWithDetails.mockResolvedValue(categorizedProduct);

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'iphone-15',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      expect(metadata.robots).toMatchObject({ index: false, follow: true });
      expect(metadata.alternates).toBeNull();
      expect(mockPermanentRedirect).not.toHaveBeenCalled();
    });

    it('redirects categorized products after the request boundary in production', async () => {
      mockGetCachedProductWithDetails.mockResolvedValue(categorizedProduct);
      mockHeaders.mockReturnValue(makeHeaders({}));

      await expect(
        resolveProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'iphone-15',
          }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockPermanentRedirect).toHaveBeenCalledWith('/phones/iphone-15');
    });

    it('preserves the development slug prefix during page render', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      mockGetCachedProductWithDetails.mockResolvedValue(categorizedProduct);
      mockHeaders.mockReturnValue(makeHeaders({}));

      await expect(
        resolveProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'iphone-15',
          }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockPermanentRedirect).toHaveBeenCalledWith(
        '/teststore/phones/iphone-15'
      );
    });
  });

  describe('uncategorized product', () => {
    it('renders metadata instead of redirecting when product has no category', async () => {
      mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'mystery-item',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      expect(mockPermanentRedirect).not.toHaveBeenCalled();
      expect(metadata.alternates?.canonical).toBe(
        'https://teststore.usebaci.com/products/mystery-item'
      );
      expect(metadata.title).toEqual({
        absolute: 'Mystery Item Price in Nigeria | TestStore',
      });
      expect(metadata.description).toContain(
        'Mystery Item price in Nigeria is ₦500,000 on TestStore'
      );
    });

    it('normalizes canonical_url host to the request-scoped storefront domain', async () => {
      mockGetRequestScopedMerchant.mockResolvedValueOnce({
        ...baseMerchant,
        custom_domain: 'ogabassey.com',
      });
      mockGetCachedProductWithDetails.mockResolvedValue({
        ...uncategorizedProduct,
        canonical_url: 'https://usebaci.com/products/mystery-item',
      });
      mockHeaders.mockReturnValue(
        makeHeaders({ 'x-custom-domain': 'ogabassey.com' })
      );

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'mystery-item',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      expect(metadata.alternates?.canonical).toBe(
        'https://ogabassey.com/products/mystery-item'
      );
    });

    it('normalizes explicit plus-model product metadata before rendering', async () => {
      mockGetCachedProductWithDetails.mockResolvedValue({
        ...uncategorizedProduct,
        id: 'prod-plus',
        name: 'Samsung Galaxy Tab S9+',
        slug: 'samsung-galaxy-tab-s9-plus',
        meta_title: 'Samsung Galaxy Tab S9+ Price in Nigeria',
        meta_description:
          'Shop Samsung Galaxy Tab S9+ tablet at Ogabassey before checkout.',
      });

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'samsung-galaxy-tab-s9-plus',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      expect(metadata.title).toEqual({
        absolute: 'Samsung Galaxy Tab S9 Plus Price in Nigeria | TestStore',
      });
      expect(metadata.description).toBe(
        'Shop Samsung Galaxy Tab S9 Plus tablet at Ogabassey before checkout.'
      );
    });

    it('uses normalized generated product metadata when explicit title sanitizes empty', async () => {
      mockGetCachedProductWithDetails.mockResolvedValue({
        ...uncategorizedProduct,
        id: 'prod-plus-empty-title',
        name: 'Samsung Galaxy Tab S9+',
        slug: 'samsung-galaxy-tab-s9-plus',
        meta_title: '<span></span>',
        meta_description: 'Shop Samsung Galaxy Tab S9+.',
      });

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'samsung-galaxy-tab-s9-plus',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      expect(metadata.title).toEqual({
        absolute: 'Samsung Galaxy Tab S9 Plus Price in Nigeria | TestStore',
      });
      expect(metadata.description).toBe('Shop Samsung Galaxy Tab S9 Plus.');
    });

    it('normalizes explicit currency-symbol product metadata before rendering', async () => {
      mockGetCachedProductWithDetails.mockResolvedValue({
        ...uncategorizedProduct,
        id: 'prod-gift-card',
        name: 'PSN Gift Card £50',
        slug: 'psn-gift-card-gbp-50',
        meta_title: 'PSN Gift Card £50 Price in Nigeria',
        meta_description:
          'PSN Gift Card £50 at Ogabassey: £50 value for PlayStation Store.',
      });

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'psn-gift-card-gbp-50',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      expect(metadata.title).toEqual({
        absolute: 'PSN Gift Card £50 GBP Price in Nigeria | TestStore',
      });
      expect(metadata.description).toBe(
        'PSN Gift Card £50 GBP at Ogabassey: £50 GBP value for PlayStation Store.'
      );
    });
  });

  it('returns noindex metadata for attribute-only variant params (real redirect happens during page render)', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(
      uncategorizedDetailedProduct
    );
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-new-128',
        attributes: { storage: '128GB', connectivity: 'WiFi' },
        condition: 'new',
        stock_quantity: 5,
      },
      {
        id: 'variant-used-128',
        attributes: { storage: '128GB', connectivity: 'WiFi' },
        condition: 'used',
        stock_quantity: 3,
      },
    ]);

    const metadata = await generateMetadata(
      {
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve({
          storage: '128GB',
          utm_source: 'google',
        }),
      },
      stubParent
    );

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('strips the internal metadata cache bucket from variant cleanup redirects', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(
      uncategorizedDetailedProduct
    );
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-new-128',
        attributes: { storage: '128GB', connectivity: 'WiFi' },
        condition: 'new',
        stock_quantity: 5,
      },
      {
        id: 'variant-used-128',
        attributes: { storage: '128GB', connectivity: 'WiFi' },
        condition: 'used',
        stock_quantity: 3,
      },
    ]);

    await expect(
      resolveProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve({
          [STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM]: 'metadata-blocking',
          storage: '128GB',
          utm_source: 'google',
        }),
      })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith(
      '/products/mystery-item?utm_source=google'
    );
  });

  it('returns noindex metadata (not a redirect) for legacy archived variant slugs so the page render issues the real HTTP 308', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue({
      id: 'parent-1',
      name: 'iPhone 13 Pro Max',
      slug: 'iphone-13-pro-max',
      category: 'Phones',
      categories: { id: 'cat-1', name: 'Phones', slug: 'phones' },
    });
    mockHeaders.mockReturnValue(
      makeHeaders({ 'x-custom-domain': 'teststore.com' })
    );

    const metadata = await generateMetadata(
      {
        params: Promise.resolve({
          slug: 'teststore.com',
          productSlug: 'iphone-13-pro-max-6gb-128gb',
        }),
        searchParams: Promise.resolve({}),
      },
      stubParent
    );

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('redirects legacy archived variant slugs during page render too', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue({
      id: 'parent-1',
      name: 'iPhone 13 Pro Max',
      slug: 'iphone-13-pro-max',
      category: 'Phones',
      categories: { id: 'cat-1', name: 'Phones', slug: 'phones' },
    });
    mockHeaders.mockReturnValue(
      makeHeaders({ 'x-custom-domain': 'teststore.com' })
    );

    await expect(
      resolveProductPage({
        params: Promise.resolve({
          slug: 'teststore.com',
          productSlug: 'iphone-13-pro-max-6gb-128gb',
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockGetCachedLegacyProductRedirectTarget).toHaveBeenCalledWith(
      'merchant-1',
      'iphone-13-pro-max-6gb-128gb'
    );
    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      '/phones/iphone-13-pro-max'
    );
  });

  it('throws notFound from metadata when product and legacy redirect are missing', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue(null);
    mockHeaders.mockReturnValue(makeHeaders({}));

    await expect(
      generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'nonexistent',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      )
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('returns a route-not-found resolution when no legacy redirect target exists', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue(null);
    mockHeaders.mockReturnValue(makeHeaders({}));

    await expect(
      resolveProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'nonexistent',
        }),
        searchParams: Promise.resolve({}),
      })
    ).resolves.toEqual({ kind: 'route-not-found' });

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('throws notFound for over-encoded bot slugs without any product lookups', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockHeaders.mockReturnValue(makeHeaders({}));
    let overEncodedSlug = 'samsung-s10 8gb-128gb';
    for (let i = 0; i < 10; i++) {
      overEncodedSlug = encodeURIComponent(overEncodedSlug);
    }

    try {
      await expect(
        resolveProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: overEncodedSlug,
          }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalledTimes(1);
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
      expect(mockGetCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('throws notFound for extremely long slugs without any product lookups', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockHeaders.mockReturnValue(makeHeaders({}));

    try {
      await expect(
        resolveProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'a'.repeat(4000),
          }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalledTimes(1);
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
      expect(mockGetCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('falls back to detailed product lookup and returns noindex metadata when category mismatch is detected', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(
      categorizedDetailedProduct
    );
    mockHeaders.mockReturnValue(makeHeaders({}));

    const metadata = await generateMetadata(
      {
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'iphone-15',
        }),
        searchParams: Promise.resolve({}),
      },
      stubParent
    );

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(mockGetCachedProductWithDetails).toHaveBeenCalledWith(
      'merchant-1',
      'iphone-15'
    );
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('strips HTML from product metadata descriptions', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...uncategorizedProduct,
      meta_description:
        '<p>The <strong>best</strong> phone for creators and gamers.</p>',
      description:
        '<p>The <strong>best</strong> phone for creators and gamers.</p>',
      images: ['https://cdn.example.com/products/mystery-item.png'],
    });

    const metadata = await generateMetadata(
      {
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve({}),
      },
      stubParent
    );

    expect(metadata.description).toBe(
      'The best phone for creators and gamers.'
    );
    expect(metadata.openGraph?.description).toBe(
      'The best phone for creators and gamers.'
    );
    expect(metadata.twitter?.description).toBe(
      'The best phone for creators and gamers.'
    );
    expect(metadata.other).toMatchObject({
      'product:price:amount': '500000',
      'product:price:currency': 'NGN',
      'product:availability': 'in stock',
      'twitter:label1': 'Price',
      'twitter:data1': 'NGN 500000',
      'twitter:label2': 'Availability',
      'twitter:data2': 'In stock',
    });
    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://cdn.example.com/products/mystery-item.png',
        alt: 'Mystery Item',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://cdn.example.com/products/mystery-item.png',
    ]);
  });

  it('keeps the OgaBassey app banner when product metadata adds social tags', async () => {
    mockGetRequestScopedMerchant.mockResolvedValueOnce({
      ...baseMerchant,
      business_name: 'Ogabassey',
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...uncategorizedProduct,
      images: ['https://cdn.example.com/products/mystery-item.png'],
    });

    const metadata = await generateMetadata(
      {
        params: Promise.resolve({
          slug: 'ogabassey',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve({}),
      },
      stubParent
    );

    expect(metadata.other).toMatchObject({
      'apple-itunes-app': 'app-id=6472735367',
      'product:price:amount': '500000',
      'product:price:currency': 'NGN',
      'product:availability': 'in stock',
    });
  });

  it('does not retry detailed lookup with a lowercased slug', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedProductWithDetails.mockResolvedValue(null);
    mockGetCachedLegacyProductRedirectTarget.mockResolvedValue(null);

    await expect(
      generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'IPHONE-15',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      )
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockGetCachedProductWithDetails).toHaveBeenCalledTimes(1);
    expect(mockGetCachedProductWithDetails).toHaveBeenCalledWith(
      'merchant-1',
      'IPHONE-15'
    );
    expect(mockGetCachedLegacyProductRedirectTarget).toHaveBeenCalledWith(
      'merchant-1',
      'IPHONE-15'
    );
  });

  describe('schema URL consistency', () => {
    it('uses the same NGN fallback currency for metadata and product JSON-LD', async () => {
      mockGetRequestScopedMerchant.mockResolvedValue({
        ...baseMerchant,
        payout_currency: null,
      });
      mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);

      const resolution = await resolveProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve({}),
      });
      if (resolution.kind !== 'product') {
        throw new Error('Expected product resolution');
      }

      render(await ProductPageRuntime(resolution.runtimeProps));

      await waitFor(() =>
        expect(mockGenerateProductSchema).toHaveBeenCalledWith(
          expect.any(Object),
          'TestStore',
          'NGN',
          'NG',
          null,
          expect.any(Object),
          expect.any(Object)
        )
      );
      expect(mockBuildStorefrontAcceptedPaymentMethods).toHaveBeenCalledWith(
        expect.objectContaining({ payout_currency: null }),
        {
          korapayConfigured: true,
          paystackConfigured: true,
          currency: 'NGN',
        }
      );
    });

    it('passes getProductUrl output into JSON-LD and breadcrumb URLs on fallback legacy pages', async () => {
      mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);
      mockHeaders.mockReturnValue(makeHeaders({}));
      mockGetProductUrl.mockReturnValue('/products/mystery-item');

      const resolution = await resolveProductPage({
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve({}),
      });
      if (resolution.kind !== 'product') {
        throw new Error('Expected product resolution');
      }

      render(await ProductPageRuntime(resolution.runtimeProps));

      // getProductUrl should have been called
      await waitFor(() => expect(mockGetProductUrl).toHaveBeenCalled());
      await waitFor(() =>
        expect(mockGenerateProductSchema).toHaveBeenCalledWith(
          expect.any(Object),
          'TestStore',
          'NGN',
          'NG',
          null,
          expect.any(Object),
          expect.objectContaining({
            acceptedPaymentMethods: ['Bank transfer'],
            productUrl: 'https://teststore.usebaci.com/products/mystery-item',
          })
        )
      );

      // Breadcrumb schema should receive the same product URL
      expect(mockGenerateBreadcrumbSchema).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            url: expect.stringContaining('/products/mystery-item'),
          }),
        ])
      );
    });

    it('uses the validated product URL for fallback metadata, JSON-LD, and breadcrumbs', async () => {
      const productUrl = 'https://teststore.usebaci.com/products/mystery-item';
      const product = {
        ...uncategorizedProduct,
        canonical_url: `${productUrl}?utm_source=google#reviews`,
      };
      mockGetCachedProductWithDetails.mockResolvedValue(product);
      mockGetValidatedProductUrl.mockReturnValue(productUrl);

      const metadata = await generateMetadata(
        {
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'mystery-item',
          }),
          searchParams: Promise.resolve({}),
        },
        stubParent
      );

      render(
        await ProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            productSlug: 'mystery-item',
          }),
          searchParams: Promise.resolve({}),
        })
      );

      expect(metadata.alternates?.canonical).toBe(productUrl);
      await waitFor(() =>
        expect(mockGetValidatedProductUrl).toHaveBeenCalledWith(
          expect.objectContaining({
            canonical_url: '/products/mystery-item',
          }),
          'https://teststore.usebaci.com',
          'teststore'
        )
      );
      await waitFor(() =>
        expect(mockGenerateProductSchema).toHaveBeenCalledWith(
          expect.any(Object),
          'TestStore',
          'NGN',
          'NG',
          null,
          expect.any(Object),
          expect.objectContaining({
            acceptedPaymentMethods: ['Bank transfer'],
            productUrl,
          })
        )
      );
      expect(mockGenerateBreadcrumbSchema).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            url: productUrl,
          }),
        ])
      );
    });
  });

  it('renders server semantic sections on the generic PDP route', async () => {
    mockGetRequestScopedMerchant.mockResolvedValue({
      ...baseMerchant,
      support_email: 'support@test.example',
      support_phone: '+2348000000000',
      trust_profile: {
        return_policy: {
          summary: 'Returns accepted within 7 days.',
          window_days: 7,
          return_method: 'mail',
          return_fees: 'free',
        },
        shipping_policy: {
          summary: 'Ships across Nigeria.',
          regions: ['NG'],
          handling_days_min: 1,
          handling_days_max: 2,
          transit_days_min: 3,
          transit_days_max: 5,
          shipping_fee_type: 'free',
        },
        customer_service: {
          whatsapp_number: '+2349000000000',
        },
      },
    });
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...uncategorizedProduct,
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
    });
    mockLoadCategoryScopedSemanticInventory.mockResolvedValue({
      isCollection: false,
      categoryName: 'Products',
      products: [
        {
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'products',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
        {
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          brand: 'Samsung',
          price: 480000,
          // Child-category slug: the PDP must pin it to the requested parent
          // category ('products') so buildProductSemanticModel's
          // `category_slug === categorySlug` filter still includes it.
          category_slug: 'foldables',
          product_key_specs: {
            chipset: 'Snapdragon 8 Elite',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
      ],
    });
    mockBuildProductSemanticModel.mockReturnValue({
      trustBullets: [],
      supportLinks: [
        {
          href: 'https://teststore.usebaci.com/products',
          label: 'Shop more Products',
        },
        {
          href: 'https://teststore.usebaci.com/products/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
          label: 'Compare with Samsung Galaxy Z TriFold',
        },
      ],
      guideLinks: [
        {
          href: 'https://teststore.usebaci.com/blog/best-phones-in-nigeria',
          title: 'Best Phones in Nigeria',
          description: 'Budget and flagship picks.',
          kind: 'best-in-nigeria',
        },
      ],
      alternatives: null,
      sameBrand: null,
      samePrice: null,
    });

    const resolution = await resolveProductPage({
      params: Promise.resolve({
        slug: 'teststore',
        productSlug: 'iphone-17-pro-max',
      }),
      searchParams: Promise.resolve({}),
    });
    if (resolution.kind !== 'product') {
      throw new Error('Expected product resolution');
    }

    render(await ProductPageRuntime(resolution.runtimeProps));

    expect(
      await screen.findByText(
        /iPhone 17 Pro Max is listed by TestStore in All Products/
      )
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', {
        name: /Shop more Products/i,
      })
    ).toHaveAttribute('href', 'https://teststore.usebaci.com/products');
    expect(
      screen.getByRole('link', {
        name: /Compare with Samsung Galaxy Z TriFold/i,
      })
    ).toHaveAttribute(
      'href',
      'https://teststore.usebaci.com/products/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
    );
    expect(
      screen.getByRole('link', {
        name: 'Best Phones in Nigeria',
      })
    ).toHaveAttribute(
      'href',
      'https://teststore.usebaci.com/blog/best-phones-in-nigeria'
    );
    // Trust bullets ("Buying context": returns/shipping/support + price summary)
    // were removed from the shared ProductSemanticSections, so they no longer
    // render on this route either.
    expect(
      screen.queryByText('Free returns within 7 days')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Ships across Nigeria')).not.toBeInTheDocument();
    expect(mockBuildProductSemanticModel).toHaveBeenCalledWith(
      expect.objectContaining({
        storeUrl: 'https://teststore.usebaci.com',
        categorySlug: 'products',
        currentProduct: expect.objectContaining({
          slug: 'iphone-17-pro-max',
        }),
        inventory: expect.arrayContaining([
          expect.objectContaining({
            slug: 'samsung-galaxy-z-trifold',
            category_slug: 'products',
          }),
        ]),
        guidePosts: [],
      })
    );
    expect(mockGenerateProductSchema).toHaveBeenCalledWith(
      expect.any(Object),
      'TestStore',
      'NGN',
      'NG',
      null,
      expect.objectContaining({
        supportEmail: 'support@test.example',
        supportPhone: '+2348000000000',
      }),
      expect.objectContaining({
        acceptedPaymentMethods: ['Bank transfer'],
        productUrl: 'https://teststore.usebaci.com/products/iphone-17-pro-max',
      })
    );
  });
});

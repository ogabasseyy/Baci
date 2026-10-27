import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontReadUnavailableError } from '@/lib/storefront-read-result';
import { loadPriceBandPage } from './load-price-band-page';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCategoryPageData = vi.fn();
const mockGetCachedFeatureSettings = vi.fn();
const mockGetPublishedClusterPosts = vi.fn();
const mockHeaders = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
  getCachedFeatureSettings: (...args: unknown[]) =>
    mockGetCachedFeatureSettings(...args),
}));

vi.mock('@/lib/storefront-content/get-published-cluster-posts', () => ({
  getPublishedClusterPosts: (...args: unknown[]) =>
    mockGetPublishedClusterPosts(...args),
}));

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  payout_currency: 'NGN',
};

const categoryPageData = {
  isCollection: false,
  fallbackName: 'Smartphones',
  products: [
    {
      id: 'product-c',
      slug: 'galaxy-a56',
      name: 'Galaxy A56',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 480_000,
      stock: 12,
      condition: 'Refurbished',
      images: ['https://cdn.example.com/a56.jpg'],
      description: '<p>Best <strong>midrange</strong> pick</p>',
    },
    {
      id: 'product-d',
      slug: 'iphone-16e',
      name: 'iPhone 16e',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 495_000,
      stock: 0,
      has_condition_offers: true,
      images: ['https://cdn.example.com/16e.jpg'],
    },
    {
      id: 'product-e',
      slug: 'redmi-note-14',
      name: 'Redmi Note 14',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Xiaomi',
      price: 650_000,
      images: ['https://cdn.example.com/redmi-note-14.jpg'],
    },
    {
      id: 'product-f',
      slug: 'tecno-camon-40',
      name: 'Tecno Camon 40',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Tecno',
      price: 550_000,
      images: ['https://cdn.example.com/tecno-camon-40.jpg'],
    },
    {
      id: 'product-g',
      slug: 'galaxy-s24-fe',
      name: 'Galaxy S24 FE',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 700_000,
      images: ['https://cdn.example.com/s24fe.jpg'],
    },
    {
      id: 'product-h',
      slug: 'galaxy-a36',
      name: 'Galaxy A36',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 360_000,
      images: ['https://cdn.example.com/a36.jpg'],
    },
  ],
};

describe('loadPriceBandPage', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetMerchantByIdentifier.mockReset();
    mockGetCachedCategoryPageData.mockReset();
    mockGetCachedFeatureSettings.mockReset();
    mockGetPublishedClusterPosts.mockReset();
    mockHeaders.mockReset();
    mockGetMerchantByIdentifier.mockResolvedValue(merchant);
    mockGetCachedCategoryPageData.mockResolvedValue(categoryPageData);
    mockGetCachedFeatureSettings.mockResolvedValue({ blog_enabled: false });
    mockGetPublishedClusterPosts.mockResolvedValue([]);
    mockHeaders.mockResolvedValue(new Headers());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed when the category catalogue is unavailable, rather than publishing a partial band (PR4b review r5)', async () => {
    // The unbounded category read is all-or-nothing: it throws rather than hand
    // back a truncated prefix. This page must NOT swallow that into a null
    // (which the route turns into a 404, deindexing a valid band page) and must
    // NOT emit a price-band model built from an incomplete inventory. Letting
    // the typed error propagate is the fail-closed contract.
    mockGetCachedCategoryPageData.mockRejectedValue(
      new StorefrontReadUnavailableError({
        kind: 'database',
        operation: 'category_page_product_ids_complete',
        retryable: true,
      })
    );

    await expect(
      loadPriceBandPage({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        priceBandSlug: 'under-1m',
      })
    ).rejects.toBeInstanceOf(StorefrontReadUnavailableError);
  });

  it('returns null immediately for an unknown price band slug without fetching category data', async () => {
    const result = await loadPriceBandPage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      priceBandSlug: 'unknown-band',
    });

    expect(result).toBeNull();
    expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it.each([
    { categoryQueryFailed: true },
    { productsQueryFailed: true },
    { productIdsQueryFailed: true },
  ])('throws when category query flags indicate failure (%o)', async (failureFlags) => {
    mockGetCachedCategoryPageData.mockResolvedValueOnce({
      ...categoryPageData,
      ...failureFlags,
    });

    await expect(
      loadPriceBandPage({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        priceBandSlug: 'under-1m',
      })
    ).rejects.toThrow('Price band inventory is temporarily unavailable');
  });

  it('returns a canonical model for an eligible curated band', async () => {
    const result = await loadPriceBandPage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      priceBandSlug: 'under-1m',
    });

    expect(result?.isIndexable).toBe(true);
    expect(result?.canonicalUrl).toBe(
      'http://localhost:3000/ogabassey/smartphones/best-under/under-1m'
    );
    expect(result?.metaTitle).toBe(
      'Best Smartphones Under ₦1,000,000 in Nigeria | Ogabassey'
    );
    expect(result?.metaDescription).toBe(
      'Compare the best smartphones under ₦1,000,000 in Nigeria. See live prices, stock, condition, and buying options from Ogabassey.'
    );
    expect(result?.heading).toBe(
      'Best Smartphones Under ₦1,000,000 in Nigeria'
    );
    expect(result?.intro).toBe(
      'These are the strongest smartphones options under ₦1,000,000 in Nigeria, based on live Ogabassey inventory with price, condition, and availability details.'
    );
    expect(result?.products).toHaveLength(6);
    expect(result?.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'iphone-16e',
          availability: 'InStock',
          stock: 0,
          condition: 'New',
          has_condition_offers: true,
        }),
        expect.objectContaining({
          slug: 'galaxy-a56',
          condition: 'Refurbished',
          has_condition_offers: false,
        }),
      ])
    );
    expect(mockGetPublishedClusterPosts).toHaveBeenCalledWith('merchant-1', {
      pageKind: 'price-band',
      categorySlug: 'smartphones',
      priceBandSlug: 'under-1m',
    });
  });

  it('uses localized ceiling text in the heading and metadata title', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      ...merchant,
      country: 'US',
      payout_currency: 'USD',
    });

    const result = await loadPriceBandPage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      priceBandSlug: 'under-1m',
    });

    expect(result?.heading).toBe('Best Smartphones Under $1,000,000');
    expect(result?.metaTitle).toBe(
      'Best Smartphones Under $1,000,000 | Ogabassey'
    );
    expect(result?.metaDescription).toContain(
      'best smartphones under $1,000,000'
    );
  });

  it('returns a non-indexable model when the curated band is below threshold', async () => {
    const result = await loadPriceBandPage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      priceBandSlug: 'under-500k',
    });

    expect(result?.isIndexable).toBe(false);
  });

  it('keeps the merchant slug path prefix for path-routed storefronts in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const result = await loadPriceBandPage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      priceBandSlug: 'under-1m',
    });

    expect(result?.pathPrefix).toBe('/ogabassey');
  });

  it('drops the path prefix for custom-domain storefront identifiers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      ...merchant,
      custom_domain: 'ogabassey.com',
    });

    const result = await loadPriceBandPage({
      merchantSlug: 'ogabassey.com',
      categorySlug: 'smartphones',
      priceBandSlug: 'under-1m',
    });

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(result?.pathPrefix).toBe('');
  });

  describe('slug safety gate', () => {
    const overEncodedSlug = (() => {
      let value = 'x y';
      for (let index = 0; index < 10; index += 1) {
        value = encodeURIComponent(value);
      }
      return value;
    })();
    const overLongSlug = 'a'.repeat(4000);

    it('returns null for a repeatedly percent-encoded category slug without hitting the cached category lookup', async () => {
      const result = await loadPriceBandPage({
        merchantSlug: 'ogabassey',
        categorySlug: overEncodedSlug,
        priceBandSlug: 'under-1m',
      });

      expect(result).toBeNull();
      expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
    });

    it('returns null for an over-long category slug without hitting the cached category lookup', async () => {
      const result = await loadPriceBandPage({
        merchantSlug: 'ogabassey',
        categorySlug: overLongSlug,
        priceBandSlug: 'under-1m',
      });

      expect(result).toBeNull();
      expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
    });

    it('returns null for an over-long price band slug without hitting the cached category lookup', async () => {
      const result = await loadPriceBandPage({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        priceBandSlug: overLongSlug,
      });

      expect(result).toBeNull();
      expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
    });

    it('still resolves a valid short slug through the cached category lookup', async () => {
      const result = await loadPriceBandPage({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        priceBandSlug: 'under-1m',
      });

      expect(mockGetCachedCategoryPageData).toHaveBeenCalledWith(
        'merchant-1',
        'smartphones',
        'ogabassey'
      );
      expect(result?.heading).toBe(
        'Best Smartphones Under ₦1,000,000 in Nigeria'
      );
    });
  });

  it('drops the path prefix for subdomain storefront requests', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockHeaders.mockResolvedValueOnce(
      new Headers([['x-merchant-slug', 'ogabassey']])
    );

    const result = await loadPriceBandPage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      priceBandSlug: 'under-1m',
    });

    expect(result?.pathPrefix).toBe('');
  });
});

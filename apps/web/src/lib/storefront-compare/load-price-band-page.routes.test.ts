import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPriceBandPage } from './load-price-band-page';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCategoryPageData = vi.fn();
const mockHeaders = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));

vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely: () => Promise.resolve([]),
}));

describe('loadPriceBandPage routes and slug safety', () => {
  const overEncodedSlug = (() => {
    let value = 'x y';
    for (let index = 0; index < 10; index += 1) {
      value = encodeURIComponent(value);
    }
    return value;
  })();
  const overLongSlug = 'a'.repeat(4000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [],
    });
  });

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
      'ogabassey',
      0,
      150
    );
    expect(result?.heading).toBe(
      'Best Smartphones Under ₦1,000,000 in Nigeria'
    );
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
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
      country: 'NG',
      payout_currency: 'NGN',
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

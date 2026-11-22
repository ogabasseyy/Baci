import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { getProductScopedCacheTag } from '@/lib/product-cache-tags';

const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();
const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCompareCategoryInventory = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();
const mockGetPublishedClusterPosts = vi.fn();
const mockHasMaintainedProductCompareRoute = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: unknown[]) => mockCacheLife(...args),
  cacheTag: (...args: unknown[]) => mockCacheTag(...args),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
}));

vi.mock('./get-cached-compare-category-inventory', () => ({
  COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT: 600,
  getCachedCompareCategoryInventory: (...args: unknown[]) =>
    mockGetCachedCompareCategoryInventory(...args),
}));

vi.mock('./has-maintained-product-compare-route', () => ({
  hasMaintainedProductCompareRoute: (...args: unknown[]) =>
    mockHasMaintainedProductCompareRoute(...args),
}));

vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely: (...args: unknown[]) =>
    mockGetPublishedClusterPosts(...args),
}));

vi.mock('./compare-page-link-helpers', () => ({
  buildRelatedCompareLinks: () => [],
  includeClickedCompareProducts: ({ products }: { products: unknown[] }) =>
    products,
  loadCompareGraphProducts: () =>
    Promise.resolve({ failed: false, products: [] }),
}));

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  payout_currency: 'NGN',
};

const leftProduct = {
  id: 'product-a',
  slug: 'iphone-17-pro-max',
  name: 'iPhone 17 Pro Max',
  category: 'Smartphones',
  category_slug: 'smartphones',
  brand: 'Apple',
  price: 2_200_000,
  status: 'active',
  product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
};

const rightProduct = {
  id: 'product-b',
  slug: 'samsung-galaxy-z-trifold',
  name: 'Samsung Galaxy Z TriFold',
  category: 'Smartphones',
  category_slug: 'smartphones',
  brand: 'Samsung',
  price: 2_300_000,
  status: 'active',
  product_key_specs: {
    chipset: 'Snapdragon 8 Elite',
    ram_gb: 16,
    storage_gb: 512,
  },
};

describe('loadComparePage cache directives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantByIdentifier.mockResolvedValue(merchant);
    mockGetCachedCompareCategoryInventory.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [leftProduct, rightProduct],
    });
    mockHasMaintainedProductCompareRoute.mockResolvedValue(true);
    mockGetCachedProductWithDetails
      .mockResolvedValueOnce(leftProduct)
      .mockResolvedValueOnce(rightProduct);
    mockGetPublishedClusterPosts.mockResolvedValue([]);
  });

  it('uses the categories cacheLife profile and tenant-scoped cache tags without global tags', async () => {
    const { loadComparePage } = await import('./load-compare-page');

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    expect(mockCacheLife).toHaveBeenCalledTimes(1);
    expect(mockCacheLife).toHaveBeenCalledWith('categories');

    const allTags = mockCacheTag.mock.calls.flat();
    expect(allTags).toEqual(
      expect.arrayContaining([
        getCategoryPageDataCacheTag('merchant-1'),
        'products-merchant-1',
        'categories-merchant-1',
        'features-merchant-1',
        'merchant-id-merchant-1',
        'merchant-ogabassey',
        getProductScopedCacheTag('product', 'merchant-1', 'iphone-17-pro-max'),
        getProductScopedCacheTag(
          'product',
          'merchant-1',
          'samsung-galaxy-z-trifold'
        ),
      ])
    );

    for (const globalTag of [
      'category-page-data',
      'products',
      'categories',
      'blog-posts',
      'merchants',
    ]) {
      expect(allTags).not.toContain(globalTag);
    }
  });
});

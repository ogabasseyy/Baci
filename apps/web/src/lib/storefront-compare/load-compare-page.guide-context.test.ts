import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadComparePage } from './load-compare-page';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCompareCategoryInventory = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();
const mockGetCachedFeatureSettings = vi.fn();
const mockGetPublishedClusterPosts = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
  getCachedFeatureSettings: (...args: unknown[]) =>
    mockGetCachedFeatureSettings(...args),
}));

vi.mock('./get-cached-compare-category-inventory', () => ({
  COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT: 600,
  getCachedCompareCategoryInventory: (...args: unknown[]) =>
    mockGetCachedCompareCategoryInventory(...args),
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

const products = [
  {
    id: 'product-a',
    slug: 'iphone-17-pro-max',
    name: 'iPhone 17 Pro Max',
    category_slug: 'smartphones',
    brand: 'Apple',
    price: 2_200_000,
    product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
  },
  {
    id: 'product-b',
    slug: 'samsung-galaxy-z-trifold',
    name: 'Samsung Galaxy Z TriFold',
    category_slug: 'smartphones',
    brand: 'Samsung',
    price: 2_300_000,
    product_key_specs: {
      chipset: 'Snapdragon 8 Elite',
      ram_gb: 16,
      storage_gb: 512,
    },
  },
] as const;

const inventory = {
  isCollection: false,
  fallbackName: 'Smartphones',
  products: products.map((product) => ({
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    price: product.price,
    category_slug: product.category_slug,
    status: 'active',
    product_key_specs: product.product_key_specs,
  })),
};

describe('loadComparePage guide context', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetMerchantByIdentifier.mockReset();
    mockGetCachedCompareCategoryInventory.mockReset();
    mockGetCachedProductWithDetails.mockReset();
    mockGetCachedFeatureSettings.mockReset();
    mockGetPublishedClusterPosts.mockReset();
    mockGetMerchantByIdentifier.mockResolvedValue(merchant);
    mockGetCachedCompareCategoryInventory.mockResolvedValue(inventory);
    mockGetCachedFeatureSettings.mockResolvedValue({ blog_enabled: false });
    mockGetPublishedClusterPosts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not block product detail fetches behind guide post loading', async () => {
    let resolveGuidePosts: ((value: []) => void) | undefined;
    const guidePostsPromise = new Promise<[]>((resolve) => {
      resolveGuidePosts = resolve;
    });
    const detailSlugs: string[] = [];

    mockGetPublishedClusterPosts.mockReturnValueOnce(guidePostsPromise);
    mockGetCachedProductWithDetails.mockImplementation(
      (_merchantId: string, productSlug: string) => {
        detailSlugs.push(productSlug);

        return productSlug === 'iphone-17-pro-max'
          ? {
              ...products[0],
              product_key_specs: {
                chipset: 'A19 Pro',
                ram_gb: 8,
                storage_gb: 256,
              },
            }
          : {
              ...products[1],
              product_key_specs: {
                chipset: 'Snapdragon 8 Elite',
                ram_gb: 16,
                storage_gb: 512,
              },
            };
      }
    );

    const resultPromise = loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    await vi.waitFor(() => {
      expect(detailSlugs).toEqual([
        'iphone-17-pro-max',
        'samsung-galaxy-z-trifold',
      ]);
    });

    expect(resolveGuidePosts).toBeDefined();
    expect(mockGetPublishedClusterPosts).toHaveBeenCalledWith('merchant-1', {
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple', 'Samsung'],
      productBrands: ['Apple', 'Samsung'],
      productNames: ['iPhone 17 Pro Max', 'Samsung Galaxy Z TriFold'],
      productSlugs: ['iphone-17-pro-max', 'samsung-galaxy-z-trifold'],
    });
    resolveGuidePosts?.([]);

    await expect(resultPromise).resolves.toMatchObject({
      kind: 'product',
      canonicalSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });
  });
});

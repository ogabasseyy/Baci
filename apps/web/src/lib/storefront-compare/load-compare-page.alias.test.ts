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

function product(slug: string, name: string, brand: string, price: number) {
  return {
    slug,
    name,
    brand,
    price,
    category_slug: 'smartphones',
    status: 'active',
    product_key_specs: { chipset: 'X', ram_gb: 8, storage_gb: 128 },
  };
}

describe('loadComparePage alias brands', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetMerchantByIdentifier.mockReset();
    mockGetCachedCompareCategoryInventory.mockReset();
    mockGetCachedProductWithDetails.mockReset();
    mockGetCachedFeatureSettings.mockReset();
    mockGetPublishedClusterPosts.mockReset();
    mockGetMerchantByIdentifier.mockResolvedValue(merchant);
    mockGetCachedFeatureSettings.mockResolvedValue({ blog_enabled: false });
    mockGetPublishedClusterPosts.mockResolvedValue([]);
    mockGetCachedCompareCategoryInventory.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        product('redmi-note-13', 'Redmi Note 13', 'Redmi', 200_000),
        product('redmi-12', 'Redmi 12', 'Redmi', 150_000),
        product('redmi-a3', 'Redmi A3', 'Redmi', 120_000),
        product('galaxy-s24', 'Galaxy S24', 'Samsung', 750_000),
        product('galaxy-a55', 'Galaxy A55', 'Samsung', 400_000),
        product('galaxy-a35', 'Galaxy A35', 'Samsung', 300_000),
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows alias-branded Redmi rows on the canonical Xiaomi comparison', async () => {
    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'xiaomi-vs-samsung',
    });

    expect(result?.kind).toBe('brand');
    expect(result?.comparisonRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Active models',
          leftValue: '3',
          rightValue: '3',
        }),
        expect.objectContaining({
          label: 'Cheapest model',
          rightValue: 'Redmi A3',
        }),
      ])
    );
  });
});

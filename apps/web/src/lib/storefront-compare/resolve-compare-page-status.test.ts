import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCanonicalProductCompareSlug } from './compare-slugs';
import { resolveComparePageStatus } from './resolve-compare-page-status';

const mockGetCachedCompareMerchantByIdentifier = vi.fn();
const mockGetCachedCompareCategoryInventory = vi.fn();
const mockGetCachedMaintainedCompareRouteManifest = vi.fn();

vi.mock('./get-cached-compare-merchant', () => ({
  getCachedCompareMerchantByIdentifier: (...args: unknown[]) =>
    mockGetCachedCompareMerchantByIdentifier(...args),
}));

vi.mock('./get-cached-compare-category-inventory', () => ({
  COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT: 600,
  getCachedCompareCategoryInventory: (...args: unknown[]) =>
    mockGetCachedCompareCategoryInventory(...args),
}));

vi.mock('./get-cached-maintained-compare-route-manifest', () => ({
  getCachedMaintainedCompareRouteManifest: (...args: unknown[]) =>
    mockGetCachedMaintainedCompareRouteManifest(...args),
}));

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  is_published: true,
};

const inventory = {
  isCollection: false,
  fallbackName: 'Laptops',
  products: [
    {
      slug: 'left-laptop',
      name: 'Left Laptop',
      brand: 'Brand A',
      price: 100,
      category_slug: 'laptops',
      status: 'active',
      product_key_specs: { ram_gb: 8 },
    },
    {
      slug: 'right-laptop',
      name: 'Right Laptop',
      brand: 'Brand B',
      price: 200,
      category_slug: 'laptops',
      status: 'active',
      product_key_specs: { ram_gb: 16 },
    },
  ],
};

const productComparison = buildCanonicalProductCompareSlug(
  'left-laptop',
  'right-laptop'
);

describe('resolveComparePageStatus', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    mockGetCachedCompareMerchantByIdentifier.mockReset();
    mockGetCachedCompareCategoryInventory.mockReset();
    mockGetCachedMaintainedCompareRouteManifest.mockReset();
    mockGetCachedCompareMerchantByIdentifier.mockResolvedValue(merchant);
    mockGetCachedCompareCategoryInventory.mockResolvedValue(inventory);
    mockGetCachedMaintainedCompareRouteManifest.mockResolvedValue([
      productComparison,
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('confirms a maintained product comparison as renderable', async () => {
    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'renderable', merchantId: 'merchant-1' });
  });

  it('fails open for a stale maintained-manifest miss', async () => {
    mockGetCachedMaintainedCompareRouteManifest.mockResolvedValue([]);

    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns missing for a malformed comparison slug', async () => {
    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: 'not-a-comparison',
      })
    ).resolves.toEqual({ kind: 'missing' });
    expect(mockGetCachedCompareCategoryInventory).not.toHaveBeenCalled();
  });

  it('returns missing for collection inventory', async () => {
    mockGetCachedCompareCategoryInventory.mockResolvedValueOnce({
      ...inventory,
      isCollection: true,
      products: [],
    });

    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'missing' });
    expect(mockGetCachedMaintainedCompareRouteManifest).not.toHaveBeenCalled();
  });

  it('fails open when a stale nonempty inventory omits a requested product', async () => {
    mockGetCachedCompareCategoryInventory.mockResolvedValueOnce({
      ...inventory,
      products: [inventory.products[0]],
    });

    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'unknown' });
    expect(mockGetCachedMaintainedCompareRouteManifest).not.toHaveBeenCalled();
  });

  it('confirms the loader-compatible brand comparison path', async () => {
    mockGetCachedCompareCategoryInventory.mockResolvedValue({
      ...inventory,
      products: [
        { ...inventory.products[0], slug: 'alpha-one', brand: 'Alpha' },
        { ...inventory.products[1], slug: 'alpha-two', brand: 'Alpha' },
        {
          ...inventory.products[0],
          slug: 'beta-one',
          brand: 'Beta',
        },
      ],
    });

    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: 'alpha-vs-beta',
      })
    ).resolves.toEqual({ kind: 'renderable', merchantId: 'merchant-1' });
    expect(mockGetCachedMaintainedCompareRouteManifest).not.toHaveBeenCalled();
  });

  it('fails open on empty or truncated inventory instead of hard-404ing', async () => {
    mockGetCachedCompareCategoryInventory.mockResolvedValueOnce({
      ...inventory,
      products: [],
    });

    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'unknown' });

    mockGetCachedCompareCategoryInventory.mockResolvedValueOnce({
      ...inventory,
      products: Array.from({ length: 600 }, (_, index) => ({
        ...inventory.products[index % inventory.products.length],
        slug: `product-${index}`,
      })),
    });

    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'unknown' });
  });

  it('fails open for unknown or unpublished storefronts', async () => {
    mockGetCachedCompareMerchantByIdentifier.mockResolvedValueOnce(null);
    await expect(
      resolveComparePageStatus({
        merchantSlug: 'unknown-store',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'unknown' });

    mockGetCachedCompareMerchantByIdentifier.mockResolvedValueOnce({
      ...merchant,
      is_published: false,
    });
    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).resolves.toEqual({ kind: 'unknown' });
  });

  it('propagates inventory failures so the endpoint can mark them unknown', async () => {
    const error = new Error('inventory unavailable');
    mockGetCachedCompareCategoryInventory.mockRejectedValueOnce(error);

    await expect(
      resolveComparePageStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: productComparison,
      })
    ).rejects.toThrow(error);
  });
});

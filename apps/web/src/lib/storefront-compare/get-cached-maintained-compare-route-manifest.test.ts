import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMaintainedCompareRouteManifest } from './get-cached-maintained-compare-route-manifest';

const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();
const mockGetCachedCompareCategoryInventory = vi.fn();
const mockGetPublishedStorefrontComparisonRevision = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: string[]) => mockCacheLife(...args),
  cacheTag: (...args: string[]) => mockCacheTag(...args),
}));

vi.mock('./get-cached-compare-category-inventory', () => ({
  getCachedCompareCategoryInventory: (...args: unknown[]) =>
    mockGetCachedCompareCategoryInventory(...args),
}));

vi.mock('./get-published-storefront-comparison-revision', () => ({
  getPublishedStorefrontComparisonRevision: (...args: unknown[]) =>
    mockGetPublishedStorefrontComparisonRevision(...args),
}));

const products = [
  {
    slug: 'left-phone',
    name: 'Left Phone',
    brand: 'Left',
    price: 500_000,
    category_slug: 'smartphones',
    status: 'active',
    product_key_specs: { chipset: 'Left', ram_gb: 8, storage_gb: 256 },
  },
  {
    slug: 'right-phone',
    name: 'Right Phone',
    brand: 'Right',
    price: 600_000,
    category_slug: 'smartphones',
    status: 'active',
    product_key_specs: { chipset: 'Right', ram_gb: 12, storage_gb: 512 },
  },
];

describe('getCachedMaintainedCompareRouteManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedCompareCategoryInventory.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products,
    });
    mockGetPublishedStorefrontComparisonRevision.mockResolvedValue('42');
  });

  it('returns serializable category manifest slugs from the bounded inventory', async () => {
    const result = await getCachedMaintainedCompareRouteManifest(
      'merchant-1',
      'smartphones',
      'ogabassey',
      'https://ogabassey.com'
    );

    expect(result).toEqual(
      expect.arrayContaining(['left-phone-vs-right-phone'])
    );
    expect(mockGetCachedCompareCategoryInventory).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      '42'
    );
    expect(mockGetPublishedStorefrontComparisonRevision).toHaveBeenCalledWith(
      'merchant-1'
    );
    expect(mockCacheLife).toHaveBeenCalledWith('products');
    expect(mockCacheTag).toHaveBeenCalledWith(
      'products-merchant-1',
      'categories-merchant-1',
      'features-merchant-1',
      'merchants',
      'merchant-id-merchant-1',
      'merchant-ogabassey'
    );
  });

  it('propagates an inventory read failure instead of returning a cacheable empty manifest', async () => {
    // Any cached manifest must only receive a complete approval set. Converting
    // an infrastructure error to [] would persist a false "unapproved" answer.
    mockGetCachedCompareCategoryInventory.mockRejectedValueOnce(
      new Error('inventory unavailable')
    );

    await expect(
      getCachedMaintainedCompareRouteManifest(
        'merchant-1',
        'smartphones',
        'ogabassey',
        'https://ogabassey.com'
      )
    ).rejects.toThrow('inventory unavailable');
  });

  it('falls back to a local manifest when the revision authority is unavailable', async () => {
    mockGetPublishedStorefrontComparisonRevision.mockRejectedValueOnce(
      new Error('revision unavailable')
    );

    await expect(
      getCachedMaintainedCompareRouteManifest(
        'merchant-1',
        'smartphones',
        'ogabassey',
        'https://ogabassey.com'
      )
    ).resolves.toContain('left-phone-vs-right-phone');

    expect(mockGetCachedCompareCategoryInventory).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      undefined
    );
  });
});

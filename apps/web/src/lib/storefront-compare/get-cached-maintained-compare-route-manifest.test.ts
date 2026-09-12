import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMaintainedCompareRouteManifest } from './get-cached-maintained-compare-route-manifest';

const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();
const mockGetCachedCompareCategoryInventory = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: string[]) => mockCacheLife(...args),
  cacheTag: (...args: string[]) => mockCacheTag(...args),
}));

vi.mock('./get-cached-compare-category-inventory', () => ({
  getCachedCompareCategoryInventory: (...args: unknown[]) =>
    mockGetCachedCompareCategoryInventory(...args),
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
      'smartphones'
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

  it('keeps the manifest local until its inventory has cross-instance authority', () => {
    // The inventory dependency is a process-local `use cache` entry. Making
    // this parent remote could publish a new shared manifest from another
    // instance's stale inventory after an invalidation, so retain the local
    // directive until a durable inventory revision is part of this cache path.
    const manifestSource = readFileSync(
      'src/lib/storefront-compare/get-cached-maintained-compare-route-manifest.ts',
      'utf8'
    );
    const loaderSource = readFileSync(
      'src/lib/storefront-compare/load-compare-page.ts',
      'utf8'
    );
    const approvalHelperSource = readFileSync(
      'src/lib/storefront-compare/has-maintained-product-compare-route.ts',
      'utf8'
    );

    expect(manifestSource).toContain("'use cache';");
    expect(manifestSource).not.toContain("'use cache: remote';");
    expect(manifestSource).not.toContain('comparisonSlug');
    expect(loaderSource).toContain('hasMaintainedProductCompareRoute(');
    expect(loaderSource).not.toContain('getMaintainedCompareRouteManifest(');
    expect(approvalHelperSource).toContain(
      'getCachedMaintainedCompareRouteManifest('
    );
    expect(approvalHelperSource).not.toContain(
      'getMaintainedCompareRouteManifest('
    );
  });
});

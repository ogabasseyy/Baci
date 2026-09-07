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

  it('keeps comparison slugs out of the cached loader API and loader wiring', () => {
    // Vitest does not execute Next's Cache Components transform, so assert the
    // source contract that defines its cache key and the consumer wiring.
    const manifestSource = readFileSync(
      'src/lib/storefront-compare/get-cached-maintained-compare-route-manifest.ts',
      'utf8'
    );
    const loaderSource = readFileSync(
      'src/lib/storefront-compare/load-compare-page.ts',
      'utf8'
    );

    expect(manifestSource).toContain("'use cache';");
    expect(manifestSource).not.toContain('comparisonSlug');
    expect(loaderSource).toContain('getCachedMaintainedCompareRouteManifest(');
    expect(loaderSource).not.toContain('getMaintainedCompareRouteManifest(');
  });
});

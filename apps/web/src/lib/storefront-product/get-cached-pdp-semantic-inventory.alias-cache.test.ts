import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedPdpSemanticInventory } from './get-cached-pdp-semantic-inventory';

const source = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    'get-cached-pdp-semantic-inventory.ts'
  ),
  'utf8'
);

const mocks = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  getCachedCompareCategoryShell: vi.fn(),
  getPublicSupabaseClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  cacheLife: (...args: unknown[]) => mocks.cacheLife(...args),
  cacheTag: (...args: unknown[]) => mocks.cacheTag(...args),
}));

vi.mock('@/lib/storefront-compare/get-cached-compare-category-shell', () => ({
  getCachedCompareCategoryShell: (...args: unknown[]) =>
    mocks.getCachedCompareCategoryShell(...args),
}));

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => mocks.getPublicSupabaseClient(),
}));

describe('bugfix: PDP semantic inventory alias cache key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedCompareCategoryShell.mockResolvedValue({
      fallbackName: 'New Arrivals',
      isCollection: true,
      productScope: { collectionSlug: 'new-arrivals', kind: 'collection' },
    });
  });

  it('ignores legacy storefront aliases while keeping one cache computation', async () => {
    // Arrange: Next.js `'use cache'` keys on the cached helper's formal args
    // (merchantId + categorySlug). A three-argument reader that also keyed on
    // legacy storefront aliases would create separate entries for the same
    // category. Simulate that production boundary so sequential alias call
    // sites share one underlying category-shell read.
    expect(getCachedPdpSemanticInventory.length).toBe(2);
    expect(source).toMatch(
      /async function getCachedPdpSemanticInventoryForSafeCategory\(\s*merchantId: string,\s*categorySlug: string\s*\)/
    );

    const inventoryCache = new Map<
      string,
      ReturnType<typeof getCachedPdpSemanticInventory>
    >();
    const invokeWithLegacyAlias = async (
      merchantId: string,
      categorySlug: string,
      _legacyStoreSlug: string
    ) => {
      const cacheKey = JSON.stringify([merchantId, categorySlug]);
      const cached = inventoryCache.get(cacheKey);
      if (cached) return cached;
      const pending = getCachedPdpSemanticInventory(merchantId, categorySlug);
      inventoryCache.set(cacheKey, pending);
      return pending;
    };

    // Act: sequential alias call sites that would diverge under a 3-arg key
    const first = await invokeWithLegacyAlias(
      'merchant-1',
      'new-arrivals',
      'ogabassey'
    );
    const second = await invokeWithLegacyAlias(
      'merchant-1',
      'new-arrivals',
      'shop-alias'
    );

    // Assert: one shared computation; aliases never reach the shell/cache key
    expect(first).toEqual(second);
    expect(first).toEqual([]);
    expect(mocks.getCachedCompareCategoryShell).toHaveBeenCalledTimes(1);
    expect(mocks.getCachedCompareCategoryShell).toHaveBeenCalledWith(
      'merchant-1',
      'new-arrivals'
    );
    expect(mocks.getCachedCompareCategoryShell.mock.calls.flat()).not.toContain(
      'ogabassey'
    );
    expect(mocks.getCachedCompareCategoryShell.mock.calls.flat()).not.toContain(
      'shop-alias'
    );
    expect(mocks.cacheTag).toHaveBeenCalledTimes(1);
    expect(
      new Set(
        ['ogabassey', 'shop-alias'].map((alias) =>
          JSON.stringify(['merchant-1', 'new-arrivals', alias])
        )
      ).size
    ).toBe(2);
  });
});

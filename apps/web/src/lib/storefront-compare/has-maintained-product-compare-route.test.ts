import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCachedMaintainedCompareRouteManifest = vi.fn();

vi.mock(
  '@/lib/storefront-compare/get-cached-maintained-compare-route-manifest',
  () => ({
    getCachedMaintainedCompareRouteManifest: (...args: unknown[]) =>
      mockGetCachedMaintainedCompareRouteManifest(...args),
  })
);

describe('hasMaintainedProductCompareRoute', () => {
  beforeEach(() => {
    mockGetCachedMaintainedCompareRouteManifest.mockReset();
  });

  it('returns false when the tenant-scoped maintained manifest omits the comparison', async () => {
    mockGetCachedMaintainedCompareRouteManifest.mockResolvedValue([
      'galaxy-a56-vs-iphone-17-pro-max',
    ]);
    const { hasMaintainedProductCompareRoute } = await import(
      '@/lib/storefront-compare/has-maintained-product-compare-route'
    );

    await expect(
      hasMaintainedProductCompareRoute({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        comparisonSlug: 'unapproved-left-vs-unapproved-right',
        storeUrl: 'https://ogabassey.com',
      })
    ).resolves.toBe(false);
  });

  it('approves a canonical slug from the matching tenant category manifest', async () => {
    mockGetCachedMaintainedCompareRouteManifest.mockResolvedValue([
      'galaxy-a56-vs-iphone-17-pro-max',
    ]);
    const { hasMaintainedProductCompareRoute } = await import(
      '@/lib/storefront-compare/has-maintained-product-compare-route'
    );

    await expect(
      hasMaintainedProductCompareRoute({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        comparisonSlug: 'galaxy-a56-vs-iphone-17-pro-max',
        storeUrl: 'https://ogabassey.com',
      })
    ).resolves.toBe(true);
    expect(mockGetCachedMaintainedCompareRouteManifest).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      'ogabassey',
      'https://ogabassey.com'
    );
  });

  it('propagates manifest failures instead of treating them as missing routes', async () => {
    const manifestError = new Error('inventory unavailable');
    mockGetCachedMaintainedCompareRouteManifest.mockRejectedValue(
      manifestError
    );
    const { hasMaintainedProductCompareRoute } = await import(
      '@/lib/storefront-compare/has-maintained-product-compare-route'
    );

    await expect(
      hasMaintainedProductCompareRoute({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        comparisonSlug: 'galaxy-a56-vs-iphone-17-pro-max',
        storeUrl: 'https://ogabassey.com',
      })
    ).rejects.toThrow(manifestError);
  });
});

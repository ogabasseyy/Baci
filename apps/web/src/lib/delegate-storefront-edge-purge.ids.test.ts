import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetProductBlogCacheRuntimeConfig = vi.fn();

vi.mock('@/lib/product-blog-cache-runtime-config', () => ({
  getProductBlogCacheRuntimeConfig: () =>
    mockGetProductBlogCacheRuntimeConfig(),
}));

import { delegateStorefrontEdgePurge } from './delegate-storefront-edge-purge';

describe('delegateStorefrontEdgePurge id-backed entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProductBlogCacheRuntimeConfig.mockReturnValue({
      baseUrl: 'https://usebaci.com',
      secret: 'internal-secret',
    });
  });

  it('sends id-backed products with resolved entry hints and omitMerchantWidePdpDetails', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"ok":true,"edgePurged":true}', { status: 200 })
      );

    try {
      const ok = await delegateStorefrontEdgePurge({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        productIds: ['prod-1', ' prod-1 '],
        productSlugs: ['iphone-15'],
        blogPostSlugs: [],
        purgeWholeStorefront: false,
      });

      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL('https://usebaci.com/api/internal/revalidate-products'),
        expect.objectContaining({
          body: JSON.stringify({
            merchantId: 'merchant-1',
            merchantSlug: 'ogabassey',
            expireProductBlogCache: true,
            confirmEdgeEviction: true,
            productSlugs: ['iphone-15'],
            omitMerchantWidePdpDetails: true,
            products: [
              {
                id: 'prod-1',
                slug: 'iphone-15',
                categorySlug: 'smartphones',
                previousSlug: null,
              },
            ],
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('pairs product ids to entries by authoritativeSlugsById rather than array index', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"ok":true,"edgePurged":true}', { status: 200 })
      );

    try {
      const ok = await delegateStorefrontEdgePurge({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        entries: [
          { slug: 'galaxy-s25', categorySegment: 'android' },
          { slug: 'iphone-15', categorySegment: 'smartphones' },
        ],
        productIds: ['prod-1', 'prod-2'],
        authoritativeSlugsById: new Map([
          ['prod-1', 'iphone-15'],
          ['prod-2', 'galaxy-s25'],
        ]),
        productSlugs: ['iphone-15', 'galaxy-s25'],
        blogPostSlugs: [],
        purgeWholeStorefront: false,
      });

      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL('https://usebaci.com/api/internal/revalidate-products'),
        expect.objectContaining({
          body: JSON.stringify({
            merchantId: 'merchant-1',
            merchantSlug: 'ogabassey',
            expireProductBlogCache: true,
            confirmEdgeEviction: true,
            productSlugs: ['iphone-15', 'galaxy-s25'],
            omitMerchantWidePdpDetails: true,
            products: [
              {
                id: 'prod-1',
                slug: 'iphone-15',
                categorySlug: 'smartphones',
                previousSlug: null,
              },
              {
                id: 'prod-2',
                slug: 'galaxy-s25',
                categorySlug: 'android',
                previousSlug: null,
              },
            ],
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('retains extra hint entries and disables scoped omission when entries outnumber productIds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"ok":true,"edgePurged":true}', { status: 200 })
      );

    try {
      const ok = await delegateStorefrontEdgePurge({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        entries: [
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'iphone-15-old', categorySegment: 'phones' },
        ],
        productIds: ['prod-1'],
        productSlugs: ['iphone-15', 'iphone-15-old'],
        blogPostSlugs: [],
        purgeWholeStorefront: false,
      });

      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL('https://usebaci.com/api/internal/revalidate-products'),
        expect.objectContaining({
          body: JSON.stringify({
            merchantId: 'merchant-1',
            merchantSlug: 'ogabassey',
            expireProductBlogCache: true,
            confirmEdgeEviction: true,
            productSlugs: ['iphone-15', 'iphone-15-old'],
            products: [
              { id: 'prod-1' },
              { slug: 'iphone-15', categorySlug: 'smartphones' },
              { slug: 'iphone-15-old', categorySlug: 'phones' },
            ],
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

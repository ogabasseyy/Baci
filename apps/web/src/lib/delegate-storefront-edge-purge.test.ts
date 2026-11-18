import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetProductBlogCacheRuntimeConfig = vi.fn();

vi.mock('@/lib/product-blog-cache-runtime-config', () => ({
  getProductBlogCacheRuntimeConfig: () =>
    mockGetProductBlogCacheRuntimeConfig(),
}));

import { delegateStorefrontEdgePurge } from './delegate-storefront-edge-purge';

describe('delegateStorefrontEdgePurge', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProductBlogCacheRuntimeConfig.mockReturnValue({
      baseUrl: 'https://usebaci.com',
      secret: 'internal-secret',
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('sends confirmed purge payload with blogPostSlugs and returns true when edgePurged is true', async () => {
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
        productSlugs: ['iphone-15'],
        blogPostSlugs: ['iphone-guide', ' iphone-guide '],
        purgeWholeStorefront: false,
      });

      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL('https://usebaci.com/api/internal/revalidate-products'),
        expect.objectContaining({
          method: 'POST',
          redirect: 'error',
          body: JSON.stringify({
            merchantId: 'merchant-1',
            merchantSlug: 'ogabassey',
            expireProductBlogCache: true,
            confirmEdgeEviction: true,
            productSlugs: ['iphone-15'],
            blogPostSlugs: ['iphone-guide'],
            products: [{ slug: 'iphone-15', categorySlug: 'smartphones' }],
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns false and warns when route returns HTTP 200 with edgePurged: false', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"ok":true,"edgePurged":false}', { status: 200 })
      );

    try {
      const ok = await delegateStorefrontEdgePurge({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        productSlugs: ['iphone-15'],
        blogPostSlugs: [],
        purgeWholeStorefront: false,
      });

      expect(ok).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        'Delegated edge purge was not confirmed by web route',
        { merchantId: 'merchant-1' }
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('escalates to purgeWholeStorefront and omits blogPostSlugs when URL count exceeds the canonical URL threshold', async () => {
    const blogPostSlugs = Array.from(
      { length: 80 },
      (_, index) => `iphone-guide-${index}`
    );
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
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
        productSlugs: ['iphone-15'],
        blogPostSlugs,
        purgeWholeStorefront: false,
      });

      expect(ok).toBe(true);
      expect(timeoutSpy).toHaveBeenCalledWith(55_000);
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL('https://usebaci.com/api/internal/revalidate-products'),
        expect.objectContaining({
          redirect: 'error',
          body: JSON.stringify({
            merchantId: 'merchant-1',
            merchantSlug: 'ogabassey',
            expireProductBlogCache: true,
            confirmEdgeEviction: true,
            productSlugs: ['iphone-15'],
            purgeWholeStorefront: true,
          }),
        })
      );
    } finally {
      timeoutSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('rejects credentialed or non-HTTP(S) baseUrl and warns', async () => {
    mockGetProductBlogCacheRuntimeConfig.mockReturnValue({
      baseUrl: 'https://user:pass@usebaci.com',
      secret: 'internal-secret',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    try {
      const ok = await delegateStorefrontEdgePurge({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        productSlugs: ['iphone-15'],
        blogPostSlugs: [],
        purgeWholeStorefront: false,
      });

      expect(ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipped delegated edge purge: invalid baseUrl',
        { merchantId: 'merchant-1' }
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects plain http for non-loopback hosts and allows loopback http origins', async () => {
    mockGetProductBlogCacheRuntimeConfig.mockReturnValueOnce({
      baseUrl: 'http://usebaci.com',
      secret: 'internal-secret',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    try {
      const blocked = await delegateStorefrontEdgePurge({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        productSlugs: ['iphone-15'],
        blogPostSlugs: [],
        purgeWholeStorefront: false,
      });

      expect(blocked).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      mockGetProductBlogCacheRuntimeConfig.mockReturnValueOnce({
        baseUrl: 'http://127.0.0.1:3000',
        secret: 'internal-secret',
      });
      fetchSpy.mockResolvedValueOnce(
        new Response('{"ok":true,"edgePurged":true}', { status: 200 })
      );

      const allowed = await delegateStorefrontEdgePurge({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        productSlugs: ['iphone-15'],
        blogPostSlugs: [],
        purgeWholeStorefront: false,
      });

      expect(allowed).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:3000/api/internal/revalidate-products'),
        expect.any(Object)
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

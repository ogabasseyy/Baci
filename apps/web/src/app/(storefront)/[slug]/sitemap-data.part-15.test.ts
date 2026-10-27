import { describe, expect, it, vi } from 'vitest';
import {
  mockGetMerchantByIdentifier,
  registerSitemapDataTests,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('resolves by domain from request x-custom-domain header even with a garbage slug override', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;
    const emptyHeaders = new Headers();
    const req = new Request('https://ogabassey.com/sitemap.xml', {
      headers: {
        'x-custom-domain': 'ogabassey.com',
      },
    });

    const context = await resolveStorefrontSitemapContext(
      emptyHeaders,
      'garbage-slug',
      req
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('tries non-www host segment before www host segment for a custom domain host', async () => {
    mockGetMerchantByIdentifier.mockImplementation((id) => {
      if (id === 'ogabassey.com') {
        return Promise.resolve({
          id: 'merchant-1',
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com',
        });
      }
      return Promise.resolve(null);
    });
    const { resolveStorefrontSitemapContext } = sitemapData;
    const emptyHeaders = new Headers();
    const req = new Request('https://www.ogabassey.com/sitemap.xml');

    const context = await resolveStorefrontSitemapContext(
      emptyHeaders,
      undefined,
      req
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      1,
      'ogabassey.com'
    );
    expect(context?.storeUrl).toBe('https://ogabassey.com');
  });

  it('skips invalid candidates without throwing and logs a warning on not-found all-miss', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      return;
    });

    try {
      mockGetMerchantByIdentifier.mockResolvedValue(null);
      const { resolveStorefrontSitemapContext } = sitemapData;
      const emptyHeaders = new Headers();
      const req = new Request('https://invalid.usebaci.com/sitemap.xml', {
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'session=secret',
          'x-custom-domain': 'invalid.example.com',
        },
      });

      const context = await resolveStorefrontSitemapContext(
        emptyHeaders,
        'cart', // reserved path, invalid candidate
        req
      );

      expect(context).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      const [, payload] = warnSpy.mock.calls.at(-1) ?? [];
      expect(payload).toMatchObject({
        safeHeaders: { 'x-custom-domain': 'invalid.example.com' },
      });
      expect(JSON.stringify(payload)).not.toContain('secret-token');
      expect(JSON.stringify(payload)).not.toContain('session=secret');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { buildStorefrontDocumentCacheHeaders } from './storefront-cdn-cache-control';

describe('buildStorefrontDocumentCacheHeaders', () => {
  describe('cacheable public storefront document', () => {
    const headers = buildStorefrontDocumentCacheHeaders('cacheable');

    it('keeps the browser layer conservative and bfcache-safe', () => {
      // max-age=0 => always revalidate; must-revalidate => no stale browser
      // serve; NOT no-store => bfcache stays eligible.
      expect(headers.cacheControl).toBe('public, max-age=0, must-revalidate');
      expect(headers.cacheControl).not.toContain('no-store');
    });

    it("caches on Vercel's CDN with a 1-hour fresh window and long stale-while-revalidate", () => {
      expect(headers.vercelCdnCacheControl).toBe(
        'max-age=3600, stale-while-revalidate=86400'
      );
    });

    it('caches longer on the downstream CDN with SWR + stale-if-error', () => {
      expect(headers.cdnCacheControl).toBe(
        'max-age=3600, stale-while-revalidate=86400, stale-if-error=86400'
      );
    });

    it('never puts s-maxage or must-revalidate on the CDN-visible header (both disable SWR/SIE)', () => {
      expect(headers.cdnCacheControl).not.toContain('s-maxage');
      expect(headers.cdnCacheControl).not.toContain('must-revalidate');
    });
  });

  it('keeps self-healing PDPs on the five-minute downstream fresh window', () => {
    const headers = buildStorefrontDocumentCacheHeaders(
      'cacheable-self-healing'
    );

    expect(headers.cdnCacheControl).toBe(
      'max-age=300, stale-while-revalidate=86400, stale-if-error=86400'
    );
  });

  it('keeps storefronts without a purge policy on Vercel-only caching', () => {
    const headers = buildStorefrontDocumentCacheHeaders(
      'cacheable-vercel-only'
    );

    expect(headers.cacheControl).toBe('public, max-age=0, must-revalidate');
    expect(headers.vercelCdnCacheControl).toBe(
      'max-age=300, stale-while-revalidate=86400'
    );
    expect(headers.cdnCacheControl).toBeNull();
  });

  describe('non-cacheable storefront document (never-cache exclusions)', () => {
    const headers = buildStorefrontDocumentCacheHeaders('non-cacheable');

    it('emits a private no-store browser directive', () => {
      expect(headers.cacheControl).toBe(
        'private, no-store, max-age=0, must-revalidate'
      );
    });

    it('signals removal of BOTH CDN headers so no shared edge retains it', () => {
      expect(headers.vercelCdnCacheControl).toBeNull();
      expect(headers.cdnCacheControl).toBeNull();
    });
  });
});

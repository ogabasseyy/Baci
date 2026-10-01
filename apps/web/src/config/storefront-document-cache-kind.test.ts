import { describe, expect, it } from 'vitest';
import { buildStorefrontDocumentCacheHeaders } from './storefront-cdn-cache-control';
import { selectStorefrontDocumentCacheKind } from './storefront-document-cache-kind';

const publicPdp = {
  cacheable: true,
  hasPurgePolicy: true,
  isPdp: true,
  durablePdpPurge: true,
  canUseLongCache: false,
};

describe('durably invalidated PDP freshness', () => {
  it('avoids five-minute downstream refreshes when exact and broad purge are covered', () => {
    const kind = selectStorefrontDocumentCacheKind(publicPdp);
    const headers = buildStorefrontDocumentCacheHeaders(kind);
    expect(headers.cdnCacheControl).toBe(
      'max-age=1800, stale-while-revalidate=86400, stale-if-error=86400'
    );
    expect(headers.vercelCdnCacheControl).toBe(
      'max-age=300, stale-while-revalidate=86400'
    );
    expect(headers.cacheControl).toBe('public, max-age=0, must-revalidate');
  });

  it('does not extend a PDP without explicit durable purge coverage', () => {
    expect(
      selectStorefrontDocumentCacheKind({
        ...publicPdp,
        durablePdpPurge: false,
      })
    ).toBe('cacheable-self-healing');
  });

  it('never adds downstream caching without a merchant purge policy', () => {
    const kind = selectStorefrontDocumentCacheKind({
      ...publicPdp,
      hasPurgePolicy: false,
    });
    expect(
      buildStorefrontDocumentCacheHeaders(kind).cdnCacheControl
    ).toBeNull();
  });

  it('never lets durable purge override private, query or unsafe method exclusion', () => {
    const kind = selectStorefrontDocumentCacheKind({
      ...publicPdp,
      cacheable: false,
    });
    const headers = buildStorefrontDocumentCacheHeaders(kind);
    expect(headers.cdnCacheControl).toBeNull();
    expect(headers.vercelCdnCacheControl).toBeNull();
    expect(headers.cacheControl).toContain('private, no-store');
  });

  it.each([
    true,
    false,
  ])('preserves non-PDP freshness (long cache: %s)', (canUseLongCache) => {
    expect(
      selectStorefrontDocumentCacheKind({
        ...publicPdp,
        isPdp: false,
        canUseLongCache,
      })
    ).toBe(canUseLongCache ? 'cacheable' : 'cacheable-self-healing');
  });
});

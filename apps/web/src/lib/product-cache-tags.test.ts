import { describe, expect, it } from 'vitest';
import {
  buildProductCanonicalPreflightCacheTagHeader,
  buildProductCanonicalRedirectCacheTags,
  buildProductDetailsCacheTags,
  buildProductLcpHintCacheTags,
  buildProductLegacyRedirectCacheTags,
  buildStorefrontPdpCoreCacheTags,
  getProductCanonicalRedirectCacheTag,
  getProductDetailsCacheTag,
  getProductLegacyRedirectCacheTag,
  getProductScopedCacheTag,
  getProductSlugSetCacheTag,
} from '@/lib/product-cache-tags';

describe('getProductScopedCacheTag', () => {
  it('preserves existing ASCII cache tag format and normalizes casing for safe product slugs', () => {
    expect(
      getProductScopedCacheTag('product', 'merchant-123', 'iphone-16-pro')
    ).toBe('product-merchant-123-iphone-16-pro');
    expect(
      getProductScopedCacheTag('product', 'Merchant-123', ' IPhone-16-Pro ')
    ).toBe('product-merchant-123-iphone-16-pro');
  });

  it('hashes non-ASCII product slugs into ByteString-safe cache tags', () => {
    const tag = getProductScopedCacheTag(
      'product',
      'merchant-123',
      'dell-alienware-x14-r2-–-14”'
    );

    expect(tag).toMatch(
      /^product-merchant-123-dell-alienware-x14-r2-14-[a-f0-9]{32}$/
    );
    expect(tag).not.toContain('–');
    expect(tag).not.toContain('”');
    expect(tag.length).toBeLessThanOrEqual(256);
  });

  it('hashes overly long tags while retaining readable context', () => {
    const tag = getProductScopedCacheTag(
      'product-legacy-redirect',
      'merchant-123',
      'x'.repeat(260)
    );

    expect(tag).toMatch(
      /^product-legacy-redirect-merchant-123-x{48}-[a-f0-9]{32}$/
    );
    expect(tag.length).toBeLessThanOrEqual(256);
  });
});

describe('getProductSlugSetCacheTag', () => {
  it('builds the dedicated per-merchant slug-set tag', () => {
    expect(getProductSlugSetCacheTag('merchant-123')).toBe(
      'product-slug-set-merchant-123'
    );
  });

  it('contains no comma (Vercel-Cache-Tag delimiter) and stays under 256 chars', () => {
    const tag = getProductSlugSetCacheTag(
      '6b5cb8a4-5575-456c-b936-8cdfae30db74'
    );

    expect(tag).not.toContain(',');
    expect(tag.length).toBeLessThanOrEqual(256);
  });
});

describe('merchant-scoped product detail and redirect cache tag builders', () => {
  it('builds consistent merchant-scoped tag names', () => {
    expect(getProductDetailsCacheTag('merchant-123')).toBe(
      'product-details-merchant-123'
    );
    expect(getProductCanonicalRedirectCacheTag('merchant-123')).toBe(
      'product-canonical-redirect-merchant-123'
    );
    expect(getProductLegacyRedirectCacheTag('merchant-123')).toBe(
      'product-legacy-redirect-merchant-123'
    );
  });

  it('builds shared cache tag arrays for PDP, LCP, canonical, and legacy redirect lookups', () => {
    const pdpCoreTags = buildStorefrontPdpCoreCacheTags(
      'merchant-123',
      'iphone-16-pro'
    );
    expect(pdpCoreTags).toEqual([
      'product',
      'product-details',
      'product-details-merchant-123',
      'product-lcp-hint',
      'categories-merchant-123',
      'product-merchant-123-iphone-16-pro',
    ]);
    expect(pdpCoreTags).not.toContain('products-merchant-123');

    const lcpHintTags = buildProductLcpHintCacheTags(
      'merchant-123',
      'iphone-16-pro'
    );
    expect(lcpHintTags).toEqual([
      'product',
      'product-lcp-hint',
      'product-details-merchant-123',
      'product-merchant-123-iphone-16-pro',
    ]);
    expect(lcpHintTags).not.toContain('products-merchant-123');
    expect(
      buildProductDetailsCacheTags('merchant-123', 'iphone-16-pro')
    ).toEqual([
      'product',
      'product-details',
      'product-details-merchant-123',
      'product-merchant-123-iphone-16-pro',
    ]);
    expect(
      buildProductCanonicalRedirectCacheTags('merchant-123', 'iphone-16-pro')
    ).toEqual([
      'product',
      'product-canonical-redirect',
      'product-canonical-redirect-merchant-123',
      'product-merchant-123-iphone-16-pro',
      'product-canonical-redirect-merchant-123-iphone-16-pro',
    ]);
    expect(
      buildProductLegacyRedirectCacheTags('merchant-123', 'iphone-16-pro')
    ).toEqual([
      'product',
      'product-legacy-redirect',
      'product-legacy-redirect-merchant-123',
      'product-legacy-redirect-merchant-123-iphone-16-pro',
    ]);
    expect(buildProductCanonicalPreflightCacheTagHeader('merchant-123')).toBe(
      'product-slug-set-merchant-123,product-canonical-redirect,product-canonical-redirect-merchant-123'
    );
  });
});

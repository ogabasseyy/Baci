import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { resolveStorefrontBlogListingStatus } from '@/lib/storefront-blog-listing-status';
import { resolveStorefrontBlogPostStatus } from '@/lib/storefront-blog-post-status';
import { resolveStorefrontCompareHubStatus } from '@/lib/storefront-compare-hub-status';
import { storefrontComparePageStatus } from '@/lib/storefront-compare-page-status';
import { getStorefrontProductCanonicalRedirectResult } from '@/lib/storefront-product-canonical-redirect';
import { resolveStorefrontProductSlugResolution } from '@/lib/storefront-product-slug-membership';
import { proxy } from './proxy';

const ROOT_DOMAIN = 'usebaci.com';

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockResolvedValue({
    supabaseResponse: new Response(null, { status: 200 }),
    user: null,
  }),
}));

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue('ogabassey'),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/env', () => ({
  getSupabaseAnonKey: () => 'anon-key',
  getSupabaseUrl: () => 'https://example.supabase.co',
}));

vi.mock('@/lib/internal-api-secret', () => ({
  getInternalApiSecret: () => 'test-internal-secret',
}));

vi.mock('@/lib/storefront-product-slug-membership', () => ({
  resolveStorefrontProductSlugResolution: vi
    .fn()
    .mockResolvedValue({ kind: 'present-or-unknown' }),
}));

vi.mock('@/lib/storefront-product-canonical-redirect', () => ({
  getStorefrontProductCanonicalRedirectResult: vi
    .fn()
    .mockResolvedValue({ kind: 'unknown' }),
}));

vi.mock('@/lib/storefront-blog-post-status', () => ({
  resolveStorefrontBlogPostStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'present-or-unknown' }),
}));

vi.mock('@/lib/storefront-blog-listing-status', () => ({
  resolveStorefrontBlogListingStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'noop' }),
}));

vi.mock('@/lib/storefront-compare-hub-status', () => ({
  resolveStorefrontCompareHubStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'renderable-or-unknown' }),
}));

vi.mock('@/lib/storefront-compare-page-status', () => ({
  storefrontComparePageStatus: {
    resolve: vi.fn().mockResolvedValue({ kind: 'renderable-or-unknown' }),
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetTime: Date.now() + 60_000,
  }),
  createRateLimitResponse: vi
    .fn()
    .mockReturnValue(new Response('Too Many Requests', { status: 429 })),
}));

describe('compare-page proxy hard-status preflight', () => {
  const comparePageStatusMock = vi.mocked(storefrontComparePageStatus.resolve);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveStorefrontProductSlugResolution).mockResolvedValue({
      kind: 'present-or-unknown',
    });
    vi.mocked(getStorefrontProductCanonicalRedirectResult).mockResolvedValue({
      kind: 'unknown',
    });
    vi.mocked(resolveStorefrontBlogPostStatus).mockResolvedValue({
      kind: 'present-or-unknown',
    });
    vi.mocked(resolveStorefrontBlogListingStatus).mockResolvedValue({
      kind: 'noop',
    });
    vi.mocked(resolveStorefrontCompareHubStatus).mockResolvedValue({
      kind: 'renderable-or-unknown',
    });
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
    comparePageStatusMock.mockResolvedValue({ kind: 'renderable-or-unknown' });
  });

  it('hard-404s a confirmed-missing compare pair on every storefront URL shape', async () => {
    comparePageStatusMock.mockResolvedValue({ kind: 'missing' });
    const requests = [
      {
        url: 'https://ogabassey.com/laptops/compare/left-laptop-vs-right-laptop',
        host: 'ogabassey.com',
      },
      {
        url: `https://ogabassey.${ROOT_DOMAIN}/laptops/compare/left-laptop-vs-right-laptop`,
        host: `ogabassey.${ROOT_DOMAIN}`,
      },
      {
        url: `https://${ROOT_DOMAIN}/ogabassey/laptops/compare/left-laptop-vs-right-laptop`,
        host: ROOT_DOMAIN,
      },
    ];

    for (const requestInput of requests) {
      const request = new NextRequest(requestInput.url);
      request.headers.set('host', requestInput.host);

      const response = await proxy(request);

      expect(response.status).toBe(404);
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    }

    expect(comparePageStatusMock).toHaveBeenCalledTimes(3);
    expect(comparePageStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'ogabassey',
        categorySlug: 'laptops',
        comparisonSlug: 'left-laptop-vs-right-laptop',
        secret: 'test-internal-secret',
      })
    );
  });

  it('keeps query variants and internal navigations fail-open', async () => {
    comparePageStatusMock.mockResolvedValue({ kind: 'missing' });
    const queryRequest = new NextRequest(
      'https://ogabassey.com/laptops/compare/left-laptop-vs-right-laptop?utm_source=email'
    );
    queryRequest.headers.set('host', 'ogabassey.com');

    const queryResponse = await proxy(queryRequest);

    expect(queryResponse.status).not.toBe(404);
    expect(comparePageStatusMock).not.toHaveBeenCalled();

    const rscRequest = new NextRequest(
      'https://ogabassey.com/laptops/compare/left-laptop-vs-right-laptop',
      { headers: { rsc: '1' } }
    );
    rscRequest.headers.set('host', 'ogabassey.com');

    const rscResponse = await proxy(rscRequest);

    expect(rscResponse.status).not.toBe(404);
    expect(comparePageStatusMock).not.toHaveBeenCalled();
  });

  it('does not hard-404 when the compare status resolver fails open', async () => {
    comparePageStatusMock.mockResolvedValue({ kind: 'renderable-or-unknown' });
    const request = new NextRequest(
      'https://ogabassey.com/laptops/compare/left-laptop-vs-right-laptop'
    );
    request.headers.set('host', 'ogabassey.com');

    const response = await proxy(request);

    expect(response.status).not.toBe(404);
    expect(comparePageStatusMock).toHaveBeenCalled();
  });
});

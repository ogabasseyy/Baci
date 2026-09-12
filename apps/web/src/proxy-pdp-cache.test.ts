import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

// Isolated fixture: never mutate the exported production policy.
vi.mock('@/config/storefront-cache', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/config/storefront-cache')>();
  return {
    ...actual,
    STOREFRONT_PUBLIC_CACHE_POLICIES:
      actual.STOREFRONT_PUBLIC_CACHE_POLICIES.map((policy) => ({
        ...policy,
        durablePdpPurge: policy.slug === 'ogabassey',
      })),
  };
});

// Mock dependencies
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockResolvedValue({
    supabaseResponse: NextResponse.next(),
    user: null, // Simulate unauthenticated by default
  }),
}));

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue('ogabassey'),
}));

// Retired-slug alias resolution. Defaults to null ("not a retired alias") so it
// is a no-op for existing tests; individual tests override it.
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));

// Mock env
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://example.supabase.co',
  getSupabaseAnonKey: () => 'anon-key',
  getInternalApiSecret: () => 'test-internal-secret',
}));

// Mock the crawl-budget product-slug membership check (PR-B §3.2). Defaults to
// "present" so it is a no-op for existing tests; individual tests override it.
vi.mock('@/lib/storefront-product-slug-membership', () => ({
  resolveStorefrontProductSlugResolution: vi
    .fn()
    .mockResolvedValue({ kind: 'present-or-unknown' }),
}));

// Mock the canonical PDP redirect lookup. Defaults to "already canonical" so
// existing rewrite/404 tests only opt into redirects when explicitly needed.
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

// Mock the empty-compare-hub preflight. Defaults to renderable-or-unknown so
// it is a no-op for existing tests; empty-hub tests override it.
vi.mock('@/lib/storefront-compare-hub-status', () => ({
  resolveStorefrontCompareHubStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'renderable-or-unknown' }),
}));

vi.mock('@/lib/storefront-blog-listing-status', () => ({
  resolveStorefrontBlogListingStatus: vi
    .fn()
    .mockResolvedValue({ kind: 'noop' }),
}));

// Mock rate limit
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetTime: 1_800_000_000_000,
  }),
  createRateLimitResponse: vi
    .fn()
    .mockReturnValue(new NextResponse('Too Many Requests', { status: 429 })),
}));

describe('qualified PDP proxy cache policy', () => {
  it('wires a qualified durable-PDP policy to the 30-minute downstream header', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/smartphones/samsung-galaxy-z-fold-4'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=300, stale-while-revalidate=86400'
    );
    expect(res.headers.get('CDN-Cache-Control')).toBe(
      'max-age=1800, stale-while-revalidate=86400, stale-if-error=86400'
    );
  });
});

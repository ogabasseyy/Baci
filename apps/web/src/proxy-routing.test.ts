import type { Span } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setAttribute = vi.fn();
const activeSpan = { setAttribute } as unknown as Span;

vi.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: vi.fn(() => activeSpan) },
}));
vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue('ogabassey'),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetTime: 1_800_000_000_000,
  }),
  createRateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockResolvedValue({
    supabaseResponse: NextResponse.next(),
    user: null,
  }),
}));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://example.supabase.co',
  getSupabaseAnonKey: () => 'anon-key',
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

import { proxy } from './proxy';

describe('proxy merchant tracing', () => {
  beforeEach(() => {
    setAttribute.mockClear();
    vi.mocked(trace.getActiveSpan).mockReturnValue(activeSpan);
  });

  it('annotates the resolved merchant on custom-domain storefront routes', async () => {
    const request = new NextRequest(
      'https://ogabassey.com/phones/example-product'
    );
    request.headers.set('host', 'ogabassey.com');

    await proxy(request);

    expect(setAttribute).toHaveBeenCalledWith('merchant.slug', 'ogabassey');
    expect(setAttribute).toHaveBeenCalledWith(
      'merchant.domain',
      'ogabassey.com'
    );
  });

  it('retains merchant tracing for platform subdomains', async () => {
    const request = new NextRequest(
      'https://ogabassey.usebaci.com/phones/example-product'
    );
    request.headers.set('host', 'ogabassey.usebaci.com');

    await proxy(request);

    expect(setAttribute).toHaveBeenCalledWith('merchant.slug', 'ogabassey');
    expect(setAttribute).toHaveBeenCalledWith(
      'merchant.domain',
      'ogabassey.usebaci.com'
    );
  });

  it('does not label the root platform domain as a merchant domain', async () => {
    const request = new NextRequest(
      'https://www.usebaci.com/phones/example-product'
    );
    request.headers.set('host', 'www.usebaci.com');

    await proxy(request);

    expect(setAttribute).toHaveBeenCalledWith('merchant.slug', 'www');
    expect(setAttribute).not.toHaveBeenCalledWith(
      'merchant.domain',
      'usebaci.com'
    );
  });

  it('does not require an active span for merchant storefront routing', async () => {
    vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);
    const request = new NextRequest(
      'https://ogabassey.com/phones/example-product'
    );
    request.headers.set('host', 'ogabassey.com');

    await expect(proxy(request)).resolves.toBeInstanceOf(NextResponse);
  });
});

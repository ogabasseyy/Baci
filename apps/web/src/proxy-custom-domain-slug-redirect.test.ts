import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSlugForCustomDomain } from '@/lib/domain-cache-simple';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { proxy } from './proxy';

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockResolvedValue({
    supabaseResponse: NextResponse.next(),
    user: null,
  }),
}));

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue('ogabassey'),
}));

vi.mock('@/lib/reverse-domain-cache', () => ({
  isRecentlyUnmappedCustomDomain: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
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

describe('proxy: custom-domain slug canonicalization and retired alias redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSlugForCustomDomain).mockResolvedValue('ogabassey');
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
  });

  it('redirects custom-domain requests that still include the merchant slug prefix', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('OgaBassey');
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
  });

  it('preserves multi-segment category/product paths on custom domains when first segment matches merchant slug', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
  });

  it('redirects slug-prefixed legacy category product URLs to the slugless route', async () => {
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
  });

  it('redirects mixed-case custom-domain slug-prefixed product URLs to the slugless canonical route', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('OgaBassey');
    const req = new NextRequest(
      'https://ogabassey.com/ogabassey/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/dell/dell-alienware-m16-r3-rtx-5070-ti'
    );
  });

  it('redirects retired custom-domain slug prefixes to the canonical domain root', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'yodhashop' ? 'zorvexa' : null
    );
    const req = new NextRequest('https://ogabassey.com/yodhashop/summer-sale');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/summer-sale'
    );
  });

  it('strips a genuine retired-slug prefix (non-route) to the slugless custom-domain URL', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'yodhashop' ? 'zorvexa' : null
    );
    const req = new NextRequest('https://ogabassey.com/yodhashop/summer-sale');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/summer-sale'
    );
  });

  it('strips a GRANDFATHERED reserved-name retired-slug prefix on a custom domain', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValueOnce('zorvexa');
    vi.mocked(getCurrentSlugForAlias).mockImplementation(async (s: string) =>
      s === 'support' ? 'zorvexa' : null
    );
    const req = new NextRequest('https://ogabassey.com/support/summer-sale');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://ogabassey.com/summer-sale'
    );
  });
});

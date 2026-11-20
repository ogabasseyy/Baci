import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import {
  getCustomDomainForSlug,
  getSlugForCustomDomain,
} from '@/lib/domain-cache-simple';
import { getRouteType } from '@/lib/proxy/routing-policy';
import { runSlugRoutingStage } from '@/lib/proxy/slug-routing';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { config, proxy } from '@/proxy';
import { GET } from './route';

const dependencies = vi.hoisted(() => ({
  rpc: vi.fn(() => ({
    setHeader: vi.fn(() => ({
      abortSignal: vi
        .fn()
        .mockResolvedValue({ data: { status: 'unavailable' } }),
    })),
  })),
}));

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/storefront-product-slug-membership', () => ({
  resolveStorefrontProductSlugResolution: vi
    .fn()
    .mockResolvedValue({ kind: 'present-or-unknown' }),
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: dependencies.rpc }),
}));

vi.mock('@/lib/brilstash/feed-rate-limit', () => ({
  checkBrilStashFeedRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const path = '/partners/yield/brilpay/products';
const query = '?page=1&limit=100&min_price=0';
const credential = 'k'.repeat(43);

it.each([
  'usebaci.com',
  'feed.usebaci.com',
  'feed.example.invalid',
])('preserves the exact path, query and credential on %s', async (host) => {
  vi.clearAllMocks();
  vi.stubEnv('BRILSTASH_FEED_HOST', host);
  vi.stubEnv('BRILSTASH_FEED_INGRESS_KEY', 'a'.repeat(64));
  vi.stubEnv('BRILSTASH_FEED_ENV', 'live');
  vi.stubEnv('BRILSTASH_SUPABASE_PROJECT_REF', 'synthetic');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.supabase.co');
  vi.stubEnv('VERCEL_ENV', 'production');
  try {
    expect(
      config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path))
    ).toBe(true);
    const request = new NextRequest(`https://${host}${path}${query}`, {
      headers: { host, authorization: `Bearer ${credential}` },
    });
    vi.mocked(getCustomDomainForSlug).mockResolvedValue(
      'merchant.example.invalid'
    );
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('another-merchant');
    vi.mocked(getSlugForCustomDomain).mockResolvedValue('merchant');
    const routed = await proxy(request);
    expect(getCurrentSlugForAlias).not.toHaveBeenCalled();
    expect(getCustomDomainForSlug).not.toHaveBeenCalled();
    expect(getSlugForCustomDomain).not.toHaveBeenCalled();
    expect(routed.headers.get('location')).toBeNull();
    expect(routed.headers.get('x-middleware-rewrite')).toBeNull();
    expect(routed.headers.get('x-middleware-next')).toBe('1');

    // Next forwards headers from the middleware override envelope to the route.
    const forwarded = new Headers();
    for (const name of routed.headers
      .get('x-middleware-override-headers')
      ?.split(',') ?? []) {
      forwarded.set(
        name,
        routed.headers.get(`x-middleware-request-${name}`) ?? ''
      );
    }
    const response = await GET(
      new NextRequest(request.url, { headers: forwarded })
    );
    expect(response.status).toBe(503);
    expect(dependencies.rpc).toHaveBeenCalledWith('read_brilstash_page', {
      p_bearer: credential,
      p_page: 1,
      p_limit: 100,
      p_min_price: 0,
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  `${path}/`,
  '/PARTNERS/Yield/BrilPay/Products',
])('keeps %s out of storefront routing', async (variant) => {
  vi.clearAllMocks();
  const request = new NextRequest(`https://usebaci.com${variant}${query}`, {
    headers: { host: 'usebaci.com', authorization: `Bearer ${credential}` },
  });
  expect(getRouteType(variant)).toBe('api');
  expect(
    await runSlugRoutingStage(request, variant, 'usebaci.com', '')
  ).toBeNull();

  const routed = await proxy(request);
  const location = routed.headers.get('location');
  if (location) {
    expect(new URL(location).origin).toBe(request.nextUrl.origin);
  }
  expect(routed.headers.get('x-middleware-rewrite')).toBeNull();
  expect(getCurrentSlugForAlias).not.toHaveBeenCalled();
  expect(getCustomDomainForSlug).not.toHaveBeenCalled();
  expect(dependencies.rpc).not.toHaveBeenCalled();
});

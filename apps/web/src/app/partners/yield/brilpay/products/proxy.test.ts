import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { getCustomDomainForSlug } from '@/lib/domain-cache-simple';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { config, proxy } from '@/proxy';
import { GET } from './route';

const dependencies = vi.hoisted(() => ({
  rpc: vi.fn(() => ({
    abortSignal: vi.fn().mockResolvedValue({ data: { status: 'unavailable' } }),
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

const path = '/partners/yield/brilpay/products';
const query = '?page=1&limit=100&min_price=0';
const credential = 'k'.repeat(43);

it('preserves the exact platform path, query and credential through normal proxy routing', async () => {
  vi.stubEnv('BRILSTASH_FEED_HOST', 'usebaci.com');
  vi.stubEnv('BRILSTASH_FEED_ENV', 'live');
  vi.stubEnv('BRILSTASH_SUPABASE_PROJECT_REF', 'synthetic');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.supabase.co');
  vi.stubEnv('VERCEL_ENV', 'production');
  try {
    expect(
      config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path))
    ).toBe(true);
    const request = new NextRequest(`https://usebaci.com${path}${query}`, {
      headers: { host: 'usebaci.com', authorization: `Bearer ${credential}` },
    });
    vi.mocked(getCustomDomainForSlug).mockResolvedValue(
      'merchant.example.invalid'
    );
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('another-merchant');
    const routed = await proxy(request);
    expect(getCurrentSlugForAlias).not.toHaveBeenCalled();
    expect(getCustomDomainForSlug).not.toHaveBeenCalled();
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
      new Request(request.url, { headers: forwarded })
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

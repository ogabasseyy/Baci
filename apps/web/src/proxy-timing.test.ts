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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetTime: Date.now() + 60000,
  }),
  createRateLimitResponse: vi
    .fn()
    .mockReturnValue(new NextResponse('Too Many Requests', { status: 429 })),
}));

const TIMING_HEADER = 'x-baci-proxy-timing';
const ENTRY = '[a-z][a-z0-9-]*;dur=\\d+\\.\\d';
const ENTRIES = new RegExp(`^(${ENTRY}, )*total;dur=\\d+\\.\\d$`);

function stepNames(response: Response): string[] {
  const value = response.headers.get(TIMING_HEADER) ?? '';
  expect(value).toMatch(ENTRIES);
  return value.split(', ').map((entry) => entry.split(';')[0] ?? '');
}

describe('proxy: stage timing header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSlugForCustomDomain).mockResolvedValue('ogabassey');
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
  });

  it('reports the stages a custom-domain cart API request ran through', async () => {
    const req = new NextRequest('https://ogabassey.com/api/storefront/cart');
    req.headers.set('host', 'ogabassey.com');

    const res = await proxy(req);

    expect(stepNames(res)).toEqual([
      'api-security',
      'domain-context',
      'domain-routing',
      'total',
    ]);
    // The route's own Server-Timing must not be written by the proxy.
    expect(res.headers.get('Server-Timing')).toBeNull();
  });

  it('reports the stages of a platform API request', async () => {
    const req = new NextRequest('https://usebaci.com/api/products');
    req.headers.set('host', 'usebaci.com');

    const res = await proxy(req);

    const names = stepNames(res);
    expect(names[0]).toBe('api-security');
    expect(names.at(-1)).toBe('total');
  });

  it('reports only the total on an early redirect', async () => {
    const req = new NextRequest('https://usebaci.com/pricing/');
    req.headers.set('host', 'usebaci.com');

    const res = await proxy(req);

    expect(res.status).toBe(308);
    expect(stepNames(res)).toEqual(['total']);
  });

  it('leaves static assets untouched', async () => {
    const req = new NextRequest('https://usebaci.com/assets/static/logo.png');
    req.headers.set('host', 'usebaci.com');

    const res = await proxy(req);

    expect(res.headers.get(TIMING_HEADER)).toBeNull();
  });
});

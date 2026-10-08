import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));
vi.mock('./host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./host')>();
  return {
    ...actual,
    getSlugForOriginCustomDomain: vi.fn().mockResolvedValue(null),
  };
});

import { getApiSecurityContext, runApiSecurityStage } from './api-security';

describe('API security stage', () => {
  it('blocks foreign browser origins for sessionless search assistance', async () => {
    const request = new NextRequest('https://usebaci.com/api/search/assist', {
      method: 'POST',
      headers: {
        origin: 'https://foreign.example',
        'content-type': 'application/json',
      },
    });
    const response = await runApiSecurityStage(
      request,
      getApiSecurityContext('/api/search/assist', 'usebaci.com', 'POST')
    );
    expect(response?.status).toBe(403);
  });
  it.each([
    undefined,
    'https://usebaci.com',
  ])('allows native or same-origin public assistance: %s', async (origin) => {
    const request = new NextRequest('https://usebaci.com/api/search/assist', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
    });
    expect(
      await runApiSecurityStage(
        request,
        getApiSecurityContext('/api/search/assist', 'usebaci.com', 'POST')
      )
    ).toBeNull();
  });

  it('maps legacy analytics POST and alias API paths to their guarded route', () => {
    expect(
      getApiSecurityContext('/analytics/conversion', 'usebaci.com', 'POST')
        .apiRateLimitPathname
    ).toBe('/api/analytics/conversion');
    expect(
      getApiSecurityContext('/old-shop/api/orders', 'usebaci.com', 'GET')
        .apiRateLimitPathname
    ).toBe('/api/orders');
  });

  it('enforces the submissions budget before the route handles the write', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      limit: 20,
      remaining: 0,
      resetTime: Date.now(),
    });
    const request = new NextRequest(
      'https://ogabassey.com/api/search/submissions',
      {
        method: 'POST',
        headers: {
          origin: 'https://ogabassey.com',
          'content-type': 'application/json',
        },
      }
    );
    const response = await runApiSecurityStage(
      request,
      getApiSecurityContext('/api/search/submissions', 'ogabassey.com', 'POST')
    );
    expect(checkRateLimit).toHaveBeenCalledWith(
      request,
      '/api/search/submissions'
    );
    expect(response?.status).toBe(429);
  });

  it('buckets alias-shaped intake paths by their normalized endpoint', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const request = new NextRequest(
      'https://usebaci.com/old-slug/api/storefront/product-requests',
      {
        method: 'POST',
        headers: {
          origin: 'https://usebaci.com',
          'content-type': 'application/json',
        },
      }
    );
    // A retired alias must receive the endpoint 10/hour budget, not the
    // generic 50/min default the raw path would select.
    await runApiSecurityStage(
      request,
      getApiSecurityContext(
        '/old-slug/api/storefront/product-requests',
        'usebaci.com',
        'POST'
      )
    );
    expect(checkRateLimit).toHaveBeenCalledWith(
      request,
      '/api/storefront/product-requests'
    );
  });

  it('blocks unsafe cross-origin mutations before a route handles them', async () => {
    const request = new NextRequest('https://usebaci.com/api/orders', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
    });
    const response = await runApiSecurityStage(
      request,
      getApiSecurityContext('/api/orders', 'usebaci.com', 'POST')
    );
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: 'Cross-origin request blocked',
    });
  });
});

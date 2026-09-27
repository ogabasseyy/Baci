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

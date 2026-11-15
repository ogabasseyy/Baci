import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./custom-domain-alias-routing', () => ({
  runCustomDomainAliasRouting: vi.fn().mockResolvedValue(null),
  runCustomDomainCurrentSlugCanonicalization: vi.fn(() => null),
}));
vi.mock('./custom-domain-api-routing', () => ({
  runCustomDomainApiRouting: vi.fn().mockResolvedValue(null),
}));
vi.mock('./storefront-preflight', () => ({
  runStorefrontPreflight: vi.fn().mockResolvedValue(null),
}));

import { runCustomDomainAliasRouting } from './custom-domain-alias-routing';
import { runCustomDomainRouting } from './custom-domain-routing';
import { runStorefrontPreflight } from './storefront-preflight';

describe('custom-domain routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runStorefrontPreflight).mockResolvedValue(null);
    vi.mocked(runCustomDomainAliasRouting).mockResolvedValue(null);
  });
  it('keeps an already prefixed custom-domain path internal while forwarding merchant context', async () => {
    const response = await runCustomDomainRouting(
      new NextRequest('https://shop.example/shop.example/products'),
      '/shop.example/products',
      'shop.example',
      'Mozilla',
      {
        domain: 'shop.example',
        domainMerchantSlug: 'shop',
        domainPathSegments: ['shop.example', 'products'],
        normalizedRequestHost: 'shop.example',
        requestHostHadWww: false,
      }
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-request-x-custom-domain')).toBe(
      'shop.example'
    );
  });
  it('does not widen custom-domain policy without an authenticated owner', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'frame.example.test');
    vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'frame.example.test');
    try {
      const path = '/checkout';
      const context = {
        domain: 'shop.example',
        domainMerchantSlug: 'shop',
        domainPathSegments: ['checkout'],
        normalizedRequestHost: 'shop.example',
        requestHostHadWww: false,
      };
      for (const [query, expected] of [
        ['', false],
        ['?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df', false],
      ] as const) {
        const request = new NextRequest(`https://shop.example${path}${query}`);
        const response = await runCustomDomainRouting(
          request,
          path,
          'shop.example',
          'Mozilla',
          context
        );
        expect(
          response.headers
            .get('Content-Security-Policy')
            ?.includes('https://frame.example.test')
        ).toBe(expected);
        expect(
          response.headers
            .get('Permissions-Policy')
            ?.includes('https://frame.example.test')
        ).toBe(expected);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('skips retired-alias lookup on valid category/product hits and runs it on 404 fallback', async () => {
    const context = {
      domain: 'shop.example',
      domainMerchantSlug: 'new-shop',
      normalizedRequestHost: 'shop.example',
      requestHostHadWww: false,
      domainPathSegments: ['phones', 'iphone-16'],
    };

    const validRes = await runCustomDomainRouting(
      new NextRequest('https://shop.example/phones/iphone-16', {
        headers: { accept: 'text/html' },
      }),
      '/phones/iphone-16',
      'shop.example',
      'Mozilla',
      context
    );
    expect(validRes.status).toBe(200);
    expect(runCustomDomainAliasRouting).not.toHaveBeenCalled();

    vi.mocked(runStorefrontPreflight).mockResolvedValueOnce(
      new NextResponse(null, { status: 404 })
    );
    const redirectRes = NextResponse.redirect(
      'https://shop.example/iphone-16',
      301
    );
    vi.mocked(runCustomDomainAliasRouting).mockResolvedValueOnce(redirectRes);

    const fallbackRes = await runCustomDomainRouting(
      new NextRequest('https://shop.example/old-shop/iphone-16', {
        headers: { accept: 'text/html' },
      }),
      '/old-shop/iphone-16',
      'shop.example',
      'Mozilla',
      { ...context, domainPathSegments: ['old-shop', 'iphone-16'] }
    );
    expect(runCustomDomainAliasRouting).toHaveBeenCalledTimes(1);
    expect(fallbackRes.status).toBe(301);
  });

  it('preserves retired-alias fallback on unchecked 3-segment paths and router-data requests', async () => {
    const context = {
      domain: 'shop.example',
      domainMerchantSlug: 'new-shop',
      normalizedRequestHost: 'shop.example',
      requestHostHadWww: false,
      domainPathSegments: ['old-shop', 'products', 'iphone-16'],
    };

    const redirect3Seg = NextResponse.redirect(
      'https://shop.example/products/iphone-16',
      301
    );
    vi.mocked(runCustomDomainAliasRouting).mockResolvedValueOnce(redirect3Seg);

    const res3Seg = await runCustomDomainRouting(
      new NextRequest('https://shop.example/old-shop/products/iphone-16', {
        headers: { accept: 'text/html' },
      }),
      '/old-shop/products/iphone-16',
      'shop.example',
      'Mozilla',
      context
    );
    expect(runCustomDomainAliasRouting).toHaveBeenCalledTimes(1);
    expect(res3Seg.status).toBe(301);

    const redirectPrefetch = NextResponse.redirect(
      'https://shop.example/summer-sale',
      301
    );
    vi.mocked(runCustomDomainAliasRouting).mockResolvedValueOnce(
      redirectPrefetch
    );

    const resPrefetch = await runCustomDomainRouting(
      new NextRequest('https://shop.example/old-shop/summer-sale', {
        headers: { 'next-router-prefetch': '1', rsc: '1' },
      }),
      '/old-shop/summer-sale',
      'shop.example',
      'Mozilla',
      { ...context, domainPathSegments: ['old-shop', 'summer-sale'] }
    );
    expect(runCustomDomainAliasRouting).toHaveBeenCalledTimes(2);
    expect(resPrefetch.status).toBe(301);
  });
});

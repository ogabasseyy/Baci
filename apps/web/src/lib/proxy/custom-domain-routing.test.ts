import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

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

import { runCustomDomainRouting } from './custom-domain-routing';

describe('custom-domain routing', () => {
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
});

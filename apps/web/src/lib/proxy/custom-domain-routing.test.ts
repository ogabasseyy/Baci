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
});

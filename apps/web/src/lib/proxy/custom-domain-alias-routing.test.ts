import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import {
  runCustomDomainAliasRouting,
  runCustomDomainCurrentSlugCanonicalization,
} from './custom-domain-alias-routing';

const context = {
  domain: 'shop.example',
  domainMerchantSlug: 'new-shop',
  normalizedRequestHost: 'shop.example',
  requestHostHadWww: false,
  pathAliasCurrentSlug: 'new-shop',
  domainPathSegments: ['old-shop', 'products', 'iphone'],
};
describe('custom-domain slug canonicalization', () => {
  it('strips a retired alias prefix on safe requests', () => {
    const response = runCustomDomainAliasRouting(
      new NextRequest('https://shop.example/old-shop/products/iphone'),
      '/old-shop/products/iphone',
      context
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe(
      'https://shop.example/products/iphone'
    );
  });

  it('redirects a current slug prefix on a 2-segment category/product path in 1 hop', () => {
    const response = runCustomDomainCurrentSlugCanonicalization(
      new NextRequest('https://ogabassey.com/ogabassey/smartphones/iphone-16'),
      '/ogabassey/smartphones/iphone-16',
      {
        domain: 'ogabassey.com',
        domainMerchantSlug: 'ogabassey',
        normalizedRequestHost: 'ogabassey.com',
        requestHostHadWww: false,
        pathAliasCurrentSlug: null,
        domainPathSegments: ['ogabassey', 'smartphones', 'iphone-16'],
      }
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe(
      'https://ogabassey.com/smartphones/iphone-16'
    );
  });

  it('does not canonicalize a slug prefix on a mutation', () => {
    expect(
      runCustomDomainCurrentSlugCanonicalization(
        new NextRequest('https://shop.example/new-shop/iphone', {
          method: 'POST',
        }),
        '/new-shop/iphone',
        { ...context, domainPathSegments: ['new-shop', 'iphone'] }
      )
    ).toBeNull();
  });

  it('preserves the exact live unlock-orders page but strips a suffixed retired alias', () => {
    const exactPath = '/unlock-orders';
    expect(
      runCustomDomainAliasRouting(
        new NextRequest(`https://shop.example${exactPath}`),
        exactPath,
        { ...context, domainPathSegments: ['unlock-orders'] }
      )
    ).toBeNull();

    const suffixedPath = '/unlock-orders/summer-sale';
    const response = runCustomDomainAliasRouting(
      new NextRequest(`https://shop.example${suffixedPath}`),
      suffixedPath,
      { ...context, domainPathSegments: ['unlock-orders', 'summer-sale'] }
    );

    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe(
      'https://shop.example/summer-sale'
    );
  });
});

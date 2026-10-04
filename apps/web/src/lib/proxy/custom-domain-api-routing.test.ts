import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue('shop'),
}));

import { runCustomDomainApiRouting } from './custom-domain-api-routing';

describe('custom-domain API routing', () => {
  it('removes a current merchant slug prefix before forwarding API requests', async () => {
    const response = await runCustomDomainApiRouting(
      new NextRequest('https://shop.example/shop/api/orders'),
      '/shop/api/orders',
      'shop.example',
      'Mozilla',
      {
        domain: 'shop.example',
        domainMerchantSlug: 'shop',
        domainPathSegments: ['shop', 'api', 'orders'],
        normalizedRequestHost: 'shop.example',
        requestHostHadWww: false,
      }
    );
    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://shop.example/api/orders'
    );
  });

  it('does not claim non-API custom-domain paths', async () => {
    await expect(
      runCustomDomainApiRouting(
        new NextRequest('https://shop.example/products'),
        '/products',
        'shop.example',
        'Mozilla',
        {
          domain: 'shop.example',
          domainMerchantSlug: 'shop',
          domainPathSegments: ['products'],
          normalizedRequestHost: 'shop.example',
          requestHostHadWww: false,
        }
      )
    ).resolves.toBeNull();
  });

  it('keeps the retired unlock-orders alias API subtree rewritable', async () => {
    const response = await runCustomDomainApiRouting(
      new NextRequest(
        'https://shop.example/unlock-orders/api/storefront/customer'
      ),
      '/unlock-orders/api/storefront/customer',
      'shop.example',
      'Mozilla',
      {
        domain: 'shop.example',
        domainMerchantSlug: 'shop',
        domainPathSegments: ['unlock-orders', 'api', 'storefront', 'customer'],
        normalizedRequestHost: 'shop.example',
        requestHostHadWww: false,
      }
    );

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://shop.example/api/storefront/customer'
    );
  });
});

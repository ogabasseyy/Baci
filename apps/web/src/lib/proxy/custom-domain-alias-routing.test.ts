import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue('new-shop'),
}));

import {
  runCustomDomainAliasRouting,
  runCustomDomainCurrentSlugCanonicalization,
} from './custom-domain-alias-routing';

const context = {
  domain: 'shop.example',
  domainMerchantSlug: 'new-shop',
  normalizedRequestHost: 'shop.example',
  requestHostHadWww: false,
  domainPathSegments: ['old-shop', 'products', 'iphone'],
};
describe('custom-domain slug canonicalization', () => {
  it('strips a retired alias prefix on safe requests', async () => {
    const response = await runCustomDomainAliasRouting(
      new NextRequest('https://shop.example/old-shop/products/iphone'),
      '/old-shop/products/iphone',
      context
    );
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe(
      'https://shop.example/products/iphone'
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

  it('preserves the exact live unlock-orders page but strips a suffixed retired alias', async () => {
    const exactPath = '/unlock-orders';
    await expect(
      runCustomDomainAliasRouting(
        new NextRequest(`https://shop.example${exactPath}`),
        exactPath,
        { ...context, domainPathSegments: ['unlock-orders'] }
      )
    ).resolves.toBeNull();

    const suffixedPath = '/unlock-orders/summer-sale';
    const response = await runCustomDomainAliasRouting(
      new NextRequest(`https://shop.example${suffixedPath}`),
      suffixedPath,
      { ...context, domainPathSegments: ['unlock-orders', 'summer-sale'] }
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe(
      'https://shop.example/summer-sale'
    );
  });
});

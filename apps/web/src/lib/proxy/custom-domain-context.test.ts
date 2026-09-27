import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/domain-cache-simple', () => ({
  getSlugForCustomDomain: vi.fn().mockResolvedValue('old-shop'),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue('new-shop'),
}));
vi.mock('./merchant-tracing', () => ({ annotateMerchantTrace: vi.fn() }));

import { resolveCustomDomainContext } from './custom-domain-context';

describe('custom domain context', () => {
  it('normalizes www and follows a stale domain slug to its current alias', async () => {
    await expect(
      resolveCustomDomainContext(
        new NextRequest('https://www.shop.example/products'),
        'www.shop.example'
      )
    ).resolves.toMatchObject({
      domain: 'shop.example',
      domainMerchantSlug: 'new-shop',
      requestHostHadWww: true,
      domainPathSegments: ['products'],
    });
  });

  it('rejects invalid custom-domain host input before a lookup', async () => {
    await expect(
      resolveCustomDomainContext(
        new NextRequest('https://localhost/'),
        'localhost'
      )
    ).resolves.toBeNull();
  });
});

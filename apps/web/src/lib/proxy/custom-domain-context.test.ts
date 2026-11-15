import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/domain-cache-simple', () => ({
  getSlugForCustomDomain: vi.fn().mockResolvedValue('old-shop'),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue('new-shop'),
}));
vi.mock('./merchant-tracing', () => ({ annotateMerchantTrace: vi.fn() }));

import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
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

  it('looks up the eligible path prefix while resolving the domain slug alias', async () => {
    const lookup = vi.mocked(getCurrentSlugForAlias);
    const calls: string[] = [];
    let finishDomainAlias: (slug: string | null) => void = () => {};
    const domainAlias = new Promise<string | null>((resolve) => {
      finishDomainAlias = resolve;
    });
    lookup.mockImplementation((slug) => {
      calls.push(slug);
      return slug === 'old-shop' ? domainAlias : Promise.resolve(null);
    });

    try {
      const context = resolveCustomDomainContext(
        new NextRequest('https://shop.example/tablets/ipad'),
        'shop.example'
      );
      await Promise.resolve();
      expect(calls).toEqual(['old-shop', 'tablets']);
      finishDomainAlias('new-shop');
      await expect(context).resolves.toMatchObject({
        domainMerchantSlug: 'new-shop',
      });
    } finally {
      finishDomainAlias('new-shop');
      lookup.mockResolvedValue('new-shop');
    }
  });

  it('reuses the domain alias lookup when the path starts with its retired slug', async () => {
    const lookup = vi.mocked(getCurrentSlugForAlias);
    lookup.mockClear();
    await expect(
      resolveCustomDomainContext(
        new NextRequest('https://shop.example/OLD-SHOP/products/iphone'),
        'shop.example'
      )
    ).resolves.toMatchObject({
      domainMerchantSlug: 'new-shop',
      pathAliasCurrentSlug: 'new-shop',
    });
    expect(lookup).toHaveBeenCalledExactlyOnceWith('old-shop');
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

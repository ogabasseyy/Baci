import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/proxy/retired-slug', () => ({
  resolveRetiredSlugRedirect: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
}));

import { resolveRetiredSlugRedirect } from '@/lib/proxy/retired-slug';
import { runSlugRoutingStage } from './slug-routing';

describe('root slug routing', () => {
  it('does not run storefront slug routing on a custom domain', async () => {
    await expect(
      runSlugRoutingStage(
        new NextRequest('https://shop.example/phones/iphone'),
        '/phones/iphone',
        'shop.example',
        'Mozilla'
      )
    ).resolves.toBeNull();
  });

  it('does not treat a platform checkout route as a merchant slug', async () => {
    await expect(
      runSlugRoutingStage(
        new NextRequest('https://usebaci.com/checkout'),
        '/checkout',
        'usebaci.com',
        'Mozilla'
      )
    ).resolves.toBeNull();
  });

  it('redirects retired merchant slug aliases with 301 permanent status', async () => {
    vi.mocked(resolveRetiredSlugRedirect).mockResolvedValueOnce(
      'https://new-shop.usebaci.com/smartphones/iphone-16'
    );

    const response = await runSlugRoutingStage(
      new NextRequest('https://usebaci.com/old-shop/smartphones/iphone-16'),
      '/old-shop/smartphones/iphone-16',
      'usebaci.com',
      'Mozilla'
    );

    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe(
      'https://new-shop.usebaci.com/smartphones/iphone-16'
    );
  });
});

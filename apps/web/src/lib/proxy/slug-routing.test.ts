import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
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
});

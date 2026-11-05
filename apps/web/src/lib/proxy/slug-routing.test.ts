import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { runSlugRoutingStage } from './slug-routing';

describe('root slug routing', () => {
  it('does not redirect the generated Ogabassey domain identifier on a preview host', async () => {
    const host = 'baci-test-basseys-projects-d7395611.vercel.app';
    await expect(
      runSlugRoutingStage(
        new NextRequest(`https://${host}/ogabassey.com`),
        '/ogabassey.com',
        host,
        'Mozilla'
      )
    ).resolves.toBeNull();
  });
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

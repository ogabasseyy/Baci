import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { parseWorkerStorefrontManifest } from '../schemas/worker-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 43 Promise-returning components, trailing-dot origins, ambiguous multi-param product routes, and variant route validation', () => {
  it('rejects synchronously declared Promise-returning components, trailing-dot origins, and ambiguous custom multi-param product routes', async () => {
    for (const content of [
      `export default function App() { return Promise.resolve(<main>Async</main>); }`,
      `export default function App() { return new Promise(() => {}); }`,
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(m)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    for (const badHost of [
      'https://attacker.usebaci.com.',
      'https://usebaci.com.',
      'https://api.usebaci.com.',
      'https://shop.ogabassey.com.',
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.hostOrigin = badHost;
      expect(() => parseWorkerStorefrontManifest(m)).toThrow();
    }

    const ambiguousRouteManifest = createOgabasseyStorefrontManifest();
    ambiguousRouteManifest.routes = [
      { path: '/', view: 'home' },
      { path: '/:department/:productSlug', view: 'product' },
    ];
    expect(() =>
      parseWorkerStorefrontManifest(ambiguousRouteManifest)
    ).toThrow();

    for (const validRoute of ['/:productSlug/:brand', '/:brand/:productSlug']) {
      const okManifest = createOgabasseyStorefrontManifest();
      okManifest.routes = [
        { path: '/', view: 'home' },
        { path: validRoute, view: 'product' },
      ];
      expect(() => parseWorkerStorefrontManifest(okManifest)).not.toThrow();
    }
  });

  it('enforces category and variantId parameters against the resolved product on product routes', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/:category/:productSlug', view: 'product' },
      { path: '/item/:slug/:brand', view: 'product' },
      { path: '/:category/:productSlug/:variantId', view: 'product' },
    ];
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App(props: { view: string; productDetail?: { slug: string } | null }) {
          return <main data-view={props.view}>{props.productDetail?.slug ?? 'none'}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const seenUrls: string[] = [];
    const iphone = {
      id: 'p1',
      slug: 'iphone-16',
      name: 'iPhone 16',
      categorySlug: 'smartphones',
      brand: 'Apple',
      condition: 'New',
      priceNgn: 1_500_000,
      inStock: true,
      imageUrl: 'https://cdn.usebaci.com/ip16.webp',
      imageAlt: 'iPhone 16',
      variants: [
        {
          id: 'var_128',
          label: '128GB',
          priceNgn: 1_500_000,
          inStock: true,
        },
      ],
    };

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        seenUrls.push(req.url);
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          product: iphone,
        });
      },
    });
    try {
      const okCat = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/iphone-16'
      );
      expect(okCat.status).toBe(200);
      expect(seenUrls.at(-1)).toContain('category=smartphones');

      const wrongCat = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/laptops/iphone-16'
      );
      expect(wrongCat.status).toBe(404);

      const okVar = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/iphone-16/var_128'
      );
      expect(okVar.status).toBe(200);

      const badVar = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/iphone-16/var_nonexistent'
      );
      expect(badVar.status).toBe(404);

      const trailingBrandOk = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/item/iphone-16/Apple'
      );
      expect(trailingBrandOk.status).toBe(200);

      const trailingBrandBad = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/item/iphone-16/Samsung'
      );
      expect(trailingBrandBad.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { parseWorkerStorefrontManifest } from '../schemas/worker-manifest';
import { compileStorefrontWorker } from './compile-storefront';
import { buildFrameErrorAsset } from './frame-error-script-snippet';

describe('Round 38 variant-only product route rejection and content-hashed frame-error asset regressions', () => {
  it('rejects variant-only or category-only product routes while allowing productSlug + variantId routes', () => {
    for (const badRoute of [
      { path: '/variants/:variantId', view: 'product' as const },
      { path: '/:category/:variant', view: 'product' as const },
      { path: '/shop/:category', view: 'product' as const },
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.routes = [{ path: '/', view: 'home' }, badRoute];
      expect(() => parseWorkerStorefrontManifest(m)).toThrow(
        /product-identifying parameter/
      );
    }

    const ok = createOgabasseyStorefrontManifest();
    ok.routes = [
      { path: '/', view: 'home' },
      { path: '/:category/:productSlug/:variantId', view: 'product' },
    ];
    expect(() => parseWorkerStorefrontManifest(ok)).not.toThrow();
  });

  it('versions the frame-error module URL by content hash when hostOrigin or previewOrigin changes', async () => {
    const composableRoutes = [
      { path: '/', view: 'home' as const },
      { path: '/collections/[handle]', view: 'collection' as const },
      { path: '/products/[handle]', view: 'product' as const },
    ];
    const m1 = createOgabasseyStorefrontManifest();
    m1.mode = 'composable';
    m1.routes = composableRoutes;
    m1.hostOrigin = 'https://shop-a.ogabassey.com';
    const m2 = createOgabasseyStorefrontManifest();
    m2.mode = 'composable';
    m2.routes = composableRoutes;
    m2.hostOrigin = 'https://shop-b.ogabassey.com';

    const asset1 = buildFrameErrorAsset(m1);
    const asset2 = buildFrameErrorAsset(m2);
    expect(asset1.path).toMatch(
      /^\/_baci\/assets\/frame-error\.[a-f0-9]{12}\.js$/
    );
    expect(asset2.path).toMatch(
      /^\/_baci\/assets\/frame-error\.[a-f0-9]{12}\.js$/
    );
    expect(asset1.path).not.toBe(asset2.path);

    const compiled1 = await compileStorefrontWorker(m1);
    const compiled2 = await compileStorefrontWorker(m2);
    expect(compiled1.workerCode).toContain(asset1.path);
    expect(compiled2.workerCode).toContain(asset2.path);
    expect(compiled2.workerCode).not.toContain(asset1.path);
  });
});

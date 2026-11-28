import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { parseWorkerStorefrontManifest } from './worker-manifest';

describe('worker-manifest schema', () => {
  it('parses valid full-code and composable manifests', () => {
    const fullCode = createOgabasseyStorefrontManifest();
    expect(parseWorkerStorefrontManifest(fullCode).merchantSlug).toBe(
      'ogabassey'
    );

    const composable = createOgabasseyStorefrontManifest();
    composable.mode = 'composable';
    composable.routes = [
      { path: '/', view: 'home' },
      { path: '/collections/[handle]', view: 'collection' },
      { path: '/products/[handle]', view: 'product' },
      { path: '/pages/warranty', view: 'editorial' },
    ];
    expect(parseWorkerStorefrontManifest(composable).mode).toBe('composable');
  });

  it('rejects path traversal, __baci_ prefix, case-insensitive collisions, missing entry, reserved /_baci routes, and mismatched usebaci hostOrigin', () => {
    const traversal = createOgabasseyStorefrontManifest();
    traversal.files.push({ path: '../escape.ts', content: 'export {};' });
    expect(() => parseWorkerStorefrontManifest(traversal)).toThrow();

    const reservedFile = createOgabasseyStorefrontManifest();
    reservedFile.files.push({
      path: '__baci_hack.ts',
      content: 'export {};',
    });
    expect(() => parseWorkerStorefrontManifest(reservedFile)).toThrow();

    const collision = createOgabasseyStorefrontManifest();
    collision.files.push(
      { path: 'src/Card.tsx', content: 'export const a = 1;' },
      { path: 'src/card.tsx', content: 'export const b = 2;' }
    );
    expect(() => parseWorkerStorefrontManifest(collision)).toThrow(
      /collision/i
    );

    const reservedRoute = createOgabasseyStorefrontManifest();
    reservedRoute.routes.push({ path: '/_baci/custom', view: 'editorial' });
    expect(() => parseWorkerStorefrontManifest(reservedRoute)).toThrow(/_baci/);

    const reservedAsset = createOgabasseyStorefrontManifest();
    reservedAsset.assets.push({
      assetId: 'catalog-product-spoof',
      alt: 'Spoof',
    });
    expect(() => parseWorkerStorefrontManifest(reservedAsset)).toThrow(
      /catalog-product-/
    );

    const wrongTenantHost = createOgabasseyStorefrontManifest();
    wrongTenantHost.hostOrigin = 'https://other-store.usebaci.com';
    expect(() => parseWorkerStorefrontManifest(wrongTenantHost)).toThrow(
      /must match merchantSlug/
    );
  });
});

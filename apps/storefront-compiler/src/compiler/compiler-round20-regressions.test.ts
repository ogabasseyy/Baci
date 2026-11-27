import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round-20 Codex navigator/permission API allowlist and product route :categoryId/:collectionId aliases', () => {
  it.each([
    [
      'navigator.geolocation.getCurrentPosition',
      `import { useEffect } from 'react';
       export default function App() {
         useEffect(() => { navigator.geolocation.getCurrentPosition(() => {}); }, []);
         return <p>geo</p>;
       }`,
    ],
    [
      'navigator.mediaDevices.getUserMedia',
      `import { useEffect } from 'react';
       export default function App() {
         useEffect(() => { void navigator.mediaDevices.getUserMedia({ video: true }); }, []);
         return <p>cam</p>;
       }`,
    ],
    [
      'window.navigator["clipboard"].readText()',
      `export default function App() {
         const c = typeof window !== 'undefined' ? window.navigator['clipboard'] : null;
         return <p>{String(Boolean(c))}</p>;
       }`,
    ],
    [
      'Notification.requestPermission()',
      `export default function App() {
         return <button type="button" onClick={() => { void Notification.requestPermission(); }}>ask</button>;
       }`,
    ],
    [
      'new PaymentRequest(...)',
      `export default function App() {
         return <button type="button" onClick={() => { void new PaymentRequest([], { total: { label: 'T', amount: { currency: 'NGN', value: '1' } } }); }}>pay</button>;
       }`,
    ],
    [
      'globalThis.valueOf().Notification.requestPermission() identity alias',
      `export default function App() {
         return <button type="button" onClick={() => { void globalThis.valueOf().Notification.requestPermission(); }}>ask</button>;
       }`,
    ],
  ])('blocks browser permission and device capability APIs: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toMatchObject({
      code: 'SOURCE_SAFETY_VIOLATION',
    });
  });

  it('permits benign read-only navigator.language reads and locally shadowed navigator objects', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          function Breadcrumbs() {
            const navigator = { permissions: ['read'] };
            return <span>{navigator.permissions.join(',')}</span>;
          }
          export default function App() {
            const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-NG';
            return <main>{lang}<Breadcrumbs /></main>;
          }
        `,
      },
    ];
    await expect(compileStorefrontWorker(manifest)).resolves.toBeDefined();
  });

  it('includes :categoryId and :collectionId in upstream product category queries', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/:categoryId/:productSlug', view: 'product' },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const requestedUrls: string[] = [];

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: (req: MiniflareRequest) => {
        requestedUrls.push(req.url);
        return new MiniflareResponse(
          JSON.stringify({
            product: {
              id: 'prod_1',
              slug: 'pro-case',
              name: 'Pro Case (Phones)',
              categorySlug: 'smartphones',
              brand: 'Apple',
              priceNgn: 15000,
              inStock: true,
              variants: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    });

    try {
      const res = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/pro-case'
      );
      expect(res.status).toBe(200);
      expect(requestedUrls).toEqual([
        'https://catalog.baci.internal/v1/product?category=smartphones&productSlug=pro-case',
      ]);
    } finally {
      await mf.dispose();
    }
  });
});

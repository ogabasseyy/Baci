import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import { describe, expect, it } from 'vitest';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import { compileStorefrontWorker } from './compile-storefront';
import * as cssSafetyExports from './css-safety';

describe('Round-18 Codex route-derived canonicalPath, nested catalog validation, DOMImplementation ban, and CSS module split', () => {
  it.each([
    [
      'document.implementation.createDocument + appendChild script injection',
      `import { useEffect } from 'react';
       export default function App() {
         useEffect(() => {
           const doc = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'script', null);
           document.head.appendChild(doc.documentElement);
         }, []);
         return <main>ok</main>;
       }`,
    ],
    [
      'document.implementation.createHTMLDocument',
      `export default function App() {
         const d = typeof document !== 'undefined' ? document.implementation.createHTMLDocument('t') : null;
         return <p>{String(Boolean(d))}</p>;
       }`,
    ],
    [
      'imperative element.replaceChildren / insertBefore',
      `import { useRef } from 'react';
       export default function App() {
         const ref = useRef<HTMLDivElement>(null);
         return <div ref={ref} onClick={() => ref.current?.replaceChildren()} />;
       }`,
    ],
  ])('blocks DOMImplementation factories and imperative DOM insertion: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toMatchObject({
      code: 'SOURCE_SAFETY_VIOLATION',
    });
  });

  it('exposes a single primary export from css-safety.ts', () => {
    expect(Object.keys(cssSafetyExports)).toEqual([
      'validateAndNormalizeMerchantCss',
    ]);
  });

  it('returns 502 when upstream search payload contains null products or malformed facets', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    let mode: 'null-product' | 'empty-facets' = 'null-product';

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify(
            mode === 'null-product'
              ? {
                  products: [null],
                  facets: { brands: [], conditions: [], totalMatches: 1 },
                }
              : {
                  products: [],
                  facets: {},
                }
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });

    try {
      const resNullProd = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/'
      );
      expect(resNullProd.status).toBe(502);

      mode = 'empty-facets';
      const resBadFacets = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/'
      );
      expect(resBadFacets.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });

  it('derives PublicProduct.canonicalPath from the manifest declared product route', async () => {
    const backing = generateOgabasseyBackingCatalog(4);
    const target = backing.find((p) => p.isPublished);
    if (!target) throw new Error('Expected published fixture');

    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId: 'merch_ogabassey',
      products: backing,
    });
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/products/:productSlug', view: 'product' },
    ];
    const compiled = await compileStorefrontWorker(manifest);

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: async (req: MiniflareRequest) => {
        const res = await plane.handleOutboundFetch(
          new Request(req.url, { method: req.method }),
          { merchantId: 'merch_ogabassey', merchantSlug: 'ogabassey' },
          'split-availability'
        );
        return new Response(await res.text(), {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
        });
      },
    });

    try {
      const prodRes = await mf.dispatchFetch(
        `https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=${encodeURIComponent(target.slug)}`
      );
      const prodJson = (await prodRes.json()) as {
        status: string;
        value: { canonicalPath?: string };
      };
      expect(prodJson.status).toBe('ok');
      expect(prodJson.value.canonicalPath).toBe(`/products/${target.slug}`);

      const routeRes = await mf.dispatchFetch(
        `https://ogabassey.mybaci.store${prodJson.value.canonicalPath}`
      );
      expect(routeRes.status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });
});

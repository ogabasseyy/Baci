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

describe('Round-19 Codex catalog product identity & variants validation, :productId route lookup, and catalog timeout', () => {
  it('rejects collection payloads missing product id or variants array with 502 / SNAPSHOT_STALE', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    let missingField: 'id' | 'variants' = 'id';

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify({
            categoryExists: true,
            products: [
              missingField === 'id'
                ? { slug: 'phone', name: 'Phone', priceNgn: 1000, variants: [] }
                : {
                    id: 'prod_1',
                    slug: 'phone',
                    name: 'Phone',
                    priceNgn: 1000,
                  },
            ],
            facets: { brands: [], conditions: [], totalMatches: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });

    try {
      const noIdRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=smartphones'
      );
      expect(noIdRes.status).toBe(502);

      missingField = 'variants';
      const noVarRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=smartphones'
      );
      expect(noVarRes.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });

  it('resolves /products/:productId routes by opaque catalog product ID when ID differs from slug', async () => {
    const backing = generateOgabasseyBackingCatalog(4);
    const target = backing.find((p) => p.isPublished);
    if (!target) throw new Error('Expected published fixture');
    expect(target.id).not.toBe(target.slug);

    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId: 'merch_ogabassey',
      products: backing,
    });
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/products/:productId', view: 'product' },
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
      const res = await mf.dispatchFetch(
        `https://ogabassey.mybaci.store/products/${encodeURIComponent(target.id)}`
      );
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain(target.name);
    } finally {
      await mf.dispose();
    }
  });

  it('aborts stalled catalog subrequests and translates timeout to 502 fallback', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: (req: MiniflareRequest) =>
        new Promise<MiniflareResponse>((_resolve, reject) => {
          req.signal.addEventListener('abort', () => {
            reject(new Error('Aborted by Worker timeout'));
          });
        }),
    });

    try {
      const started = Date.now();
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      const elapsed = Date.now() - started;
      expect(res.status).toBe(502);
      expect(elapsed).toBeLessThan(6000);
    } finally {
      await mf.dispose();
    }
  });

  it('supports static CommonJS require("react") in .js entries across prebundling without emitting dynamic __require', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.entry = 'src/App.js';
    manifest.files = [
      {
        path: 'src/App.js',
        content: `
          const React = require('react');
          export default function App() {
            return React.version;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.clientCode).not.toContain('Dynamic require of');
    expect(compiled.workerCode).not.toContain('Dynamic require of');

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify({
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });

    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toMatch(/<div id="root">19\./);
    } finally {
      await mf.dispose();
    }
  });
});

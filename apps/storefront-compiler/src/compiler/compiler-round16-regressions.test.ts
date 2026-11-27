import { Miniflare, type Request as MiniflareRequest } from 'miniflare';
import { describe, expect, it } from 'vitest';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round-16 Codex Web Storage ban, composite inline style URLs, single-variant requiresVariant, and dual-generation catalog revision', () => {
  it.each([
    [
      'direct localStorage.getItem()',
      `export default function App() {
         const tok = typeof localStorage !== 'undefined' ? localStorage.getItem('baci_handoff') : '';
         return <p>{tok}</p>;
       }`,
    ],
    [
      'direct sessionStorage.getItem()',
      `export default function App() {
         const tok = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('baci_handoff') : '';
         return <p>{tok}</p>;
       }`,
    ],
    [
      'window.localStorage member read',
      `export default function App() {
         const s = typeof window !== 'undefined' ? window.localStorage.length : 0;
         return <p>{s}</p>;
       }`,
    ],
    [
      'globalThis["sessionStorage"] bracket read',
      `export default function App() {
         const s = globalThis['session' + 'Storage'];
         return <p>{String(Boolean(s))}</p>;
       }`,
    ],
    [
      'navigator.storage persistence read',
      `export default function App() {
         const s = typeof navigator !== 'undefined' ? navigator.storage : null;
         return <p>{String(Boolean(s))}</p>;
       }`,
    ],
  ])('blocks Web Storage and origin storage access with DIRECT_COOKIE_ACCESS: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toMatchObject({
      code: 'SOURCE_SAFETY_VIOLATION',
    });
  });

  it('preserves composite inline background values (linear-gradient + declared url and image-set) while stripping undeclared runtime URLs', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          export default function App(props: { title: string }) {
            const badDynamic = \`linear-gradient(#000, #111), url('\${props.title}')\`;
            return (
              <main>
                <div
                  id="composite-valid"
                  style={{
                    backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.4), transparent), url('/assets/hero-banner')",
                  }}
                />
                <div
                  id="imageset-valid"
                  style={{
                    backgroundImage: 'image-set("/assets/hero-banner" 1x, url("/assets/hero-banner") 2x)',
                  }}
                />
                <div id="composite-evil" style={{ backgroundImage: badDynamic }} />
              </main>
            );
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: async () =>
        new Response(
          JSON.stringify({
            title: 'https://cdn.usebaci.com/undeclared-tracker.png',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('linear-gradient(180deg');
      expect(html).toContain('/assets/hero-banner');
      expect(html).toContain('image-set(');
      expect(html).toContain('<div id="composite-evil"></div>');
    } finally {
      await mf.dispose();
    }
  });

  it('marks single-variant products requiresVariant: true and updates PublicCatalog.revision on structural metadata writes', async () => {
    const backing = generateOgabasseyBackingCatalog(4);
    const singleVarProduct = backing.find((p) => p.isPublished);
    if (!singleVarProduct) throw new Error('Expected published fixture');
    singleVarProduct.variants = singleVarProduct.variants.slice(0, 1);

    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId: 'merch_ogabassey',
      products: backing,
    });
    const manifest = createOgabasseyStorefrontManifest();
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
        `https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=${encodeURIComponent(singleVarProduct.slug)}`
      );
      const prodJson = (await prodRes.json()) as {
        status: string;
        value: { requiresVariant: boolean; variants: unknown[] };
      };
      expect(prodJson.status).toBe('ok');
      expect(prodJson.value.variants).toHaveLength(1);
      expect(prodJson.value.requiresVariant).toBe(true);

      const colBefore = (await (
        await mf.dispatchFetch(
          `https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=${encodeURIComponent(singleVarProduct.categorySlug)}`
        )
      ).json()) as { status: string; value: { revision: string } };

      plane.recordCatalogMetadataWrite('merch_ogabassey');
      plane.advanceClockMs(20_000);

      const colAfter = (await (
        await mf.dispatchFetch(
          `https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=${encodeURIComponent(singleVarProduct.categorySlug)}`
        )
      ).json()) as { status: string; value: { revision: string } };

      expect(colAfter.value.revision).not.toBe(colBefore.value.revision);
    } finally {
      await mf.dispose();
    }
  });
});

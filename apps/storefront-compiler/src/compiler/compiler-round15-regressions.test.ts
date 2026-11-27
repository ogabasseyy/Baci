import vm from 'node:vm';
import { Miniflare, type Request as MiniflareRequest } from 'miniflare';
import { describe, expect, it } from 'vitest';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round-15 Codex SDK Link path validation, JSX <style> ban, and hydrated catalog.* bridge', () => {
  it.each([
    [
      'direct SDK <Link path="https://evil.example">',
      [
        {
          path: 'src/StorefrontApp.tsx',
          content: `
            import { Link } from '@baci/experience-sdk';
            export default function App() {
              return <Link path="https://evil.example/phish">Leave</Link>;
            }
          `,
        },
      ],
    ],
    [
      'aliased & re-exported SDK Link with spread external path',
      [
        {
          path: 'src/nav.ts',
          content: `export { Link as NavLink } from '@baci/experience-sdk';`,
        },
        {
          path: 'src/StorefrontApp.tsx',
          content: `
            import { NavLink } from './nav';
            const ShopLink = NavLink;
            export default function App() {
              return <ShopLink {...{ path: '//evil.example/phish' }}>Leave</ShopLink>;
            }
          `,
        },
      ],
    ],
    [
      'embedded JSX <style> element bypassing CSS asset scanner',
      [
        {
          path: 'src/StorefrontApp.tsx',
          content: `
            export default function App() {
              return (
                <main>
                  <style>{'.hero{background:url("https://cdn.usebaci.com/undeclared.png")}'}</style>
                  <div className="hero">Hello</div>
                </main>
              );
            }
          `,
        },
      ],
    ],
    [
      'inline JSX style prop with undeclared background-image url()',
      [
        {
          path: 'src/StorefrontApp.tsx',
          content: `
            export default function App() {
              return <div style={{ backgroundImage: 'url("https://cdn.usebaci.com/undeclared.png")' }} />;
            }
          `,
        },
      ],
    ],
  ])('rejects unsafe source pattern with SOURCE_SAFETY_VIOLATION: %s', async (_label, files) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = files;
    await expect(compileStorefrontWorker(manifest)).rejects.toMatchObject({
      code: 'SOURCE_SAFETY_VIOLATION',
    });
  });

  it('permits safe internal <Link path="..."> and sanitizes runtime protocol-relative Link paths in SSR', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import { Link } from '@baci/experience-sdk';
          export default function App(props: { products: Array<{ slug: string }> }) {
            const dyn = props.products[0]?.slug ?? 'safe';
            return (
              <nav>
                <Link path="/smartphones">Phones</Link>
                <Link id="dyn-sdk-link" path={\`/\${dyn}\`}>Dynamic</Link>
              </nav>
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
            products: [
              {
                id: '1',
                slug: '/evil.example/hijack',
                name: 'Item',
                priceNgn: 1000,
                variants: [],
              },
            ],
            facets: { brands: [], conditions: [], totalMatches: 1 },
          }),
          { headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('href="/smartphones"');
      expect(html).toContain('id="dyn-sdk-link" href="#"');
      expect(html).not.toContain('//evil.example');
    } finally {
      await mf.dispose();
    }
  });

  it('serves catalog.collection, catalog.product, and catalog.variants end-to-end after hydration without requiring cart enrollment', async () => {
    const backing = generateOgabasseyBackingCatalog(8);
    const firstPublished = backing.find((p) => p.isPublished);
    if (!firstPublished) throw new Error('Expected published fixture product');

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
      const entrySrc = buildClientHydrationEntrySource(
        'src/StorefrontApp.tsx',
        {}
      );
      let transport:
        | ((
            method: string,
            args: Record<string, unknown>
          ) => Promise<{
            status: string;
            code?: string;
            value?: unknown;
          }>)
        | undefined;

      const stubBody = entrySrc
        .replace(
          "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
          'const CommerceProvider = "CommerceProvider"; const createCommerceClient = (fn) => { __capture(fn); return fn; };'
        )
        .replace(
          "import { createElement } from 'react';",
          'const createElement = () => ({});'
        )
        .replace(
          "import { hydrateRoot } from 'react-dom/client';",
          'const hydrateRoot = () => {};'
        )
        .replace(
          'await import("./src/StorefrontApp.tsx")',
          'await Promise.resolve({ default: () => null })'
        );

      const winMock = {
        location: {
          origin: 'https://ogabassey.mybaci.store',
          assign: () => {},
        },
        parent: null as unknown,
        open: () => null,
      };
      winMock.parent = winMock;

      vm.runInNewContext(stubBody, {
        URL,
        fetch: (input: string, init?: RequestInit) =>
          mf.dispatchFetch(input, init as never),
        __capture: (fn: typeof transport) => {
          transport = fn;
        },
        window: winMock,
        document: {
          getElementById: (id: string) =>
            id === 'root'
              ? {}
              : {
                  textContent: JSON.stringify({
                    view: 'home',
                    merchantSlug: 'ogabassey',
                  }),
                },
        },
      });

      if (!transport) throw new Error('Expected hydration commerce transport');

      const colRes = await transport('catalog.collection', {
        handle: firstPublished.categorySlug,
      });
      expect(colRes.status).toBe('ok');
      const colVal = colRes.value as {
        products: Array<{ id: string; slug: string }>;
        revision: string;
      };
      expect(colVal.products.length).toBeGreaterThan(0);
      expect(typeof colVal.revision).toBe('string');

      const prodRes = await transport('catalog.product', {
        handle: firstPublished.slug,
      });
      expect(prodRes).toMatchObject({
        status: 'ok',
        value: {
          id: firstPublished.id,
          slug: firstPublished.slug,
          name: firstPublished.name,
          currency: 'NGN',
        },
      });

      const varRes = await transport('catalog.variants', {
        productId: firstPublished.id,
      });
      expect(varRes.status).toBe('ok');
      const variants = varRes.value as Array<{
        id: string;
        available: boolean;
      }>;
      expect(variants).toHaveLength(firstPublished.variants.length);
      expect(variants[0]?.id).toBe(firstPublished.variants[0]?.id);

      const missingRes = await transport('catalog.product', {
        handle: 'does-not-exist-999',
      });
      expect(missingRes).toMatchObject({
        status: 'error',
        code: 'NOT_FOUND',
      });
    } finally {
      await mf.dispose();
    }
  });
});

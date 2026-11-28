import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round-10 & Round-12 SSR containment, aliased JSX tags, ownerDocument.write, and catalog JSON validation', () => {
  it('contains top-level and render-time merchant failures inside fetch() while allowing forwardRef default exports', async () => {
    for (const crashingSource of [
      `const brokenTopLevelWidth = window.innerWidth;
       export default function App() { return <main>{String(brokenTopLevelWidth)}</main>; }`,
      `export default function CrashingApp(props: { productDetail: { name: string } | null }) {
         if (!props.productDetail) throw new Error('Merchant bug');
         return <main>{props.productDetail.name}</main>;
       }`,
    ]) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [
        { path: 'src/StorefrontApp.tsx', content: crashingSource },
      ];
      const compiled = await compileStorefrontWorker(manifest);
      const mf = new Miniflare({
        modules: [
          {
            type: 'ESModule',
            path: 'worker.mjs',
            contents: compiled.workerCode,
          },
        ],
        compatibilityDate: '2026-07-01',
        bindings: {},
        outboundService: () =>
          new MiniflareResponse(
            JSON.stringify({
              title: 'Home',
              products: [],
              facets: { brands: [], conditions: [], totalMatches: 0 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          ),
      });
      try {
        const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
        expect(res.status).toBe(500);
        expect(res.headers.get('content-security-policy')).toContain(
          "default-src 'self'"
        );
        const html = await res.text();
        expect(html).toContain('noindex, nofollow');
        expect(html).toContain('Storefront Render Error');
        expect(html).not.toContain('__BACI_STOREFRONT_STATE__');
        expect(html).not.toContain('Merchant bug');
      } finally {
        await mf.dispose();
      }
    }

    const forwardRefManifest = createOgabasseyStorefrontManifest();
    forwardRefManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { forwardRef } from 'react';
export default forwardRef<HTMLElement, { title: string }>(function App(props, ref) { return <main ref={ref}>{props.title}</main>; });`,
      },
    ];
    const forwardRefCompiled =
      await compileStorefrontWorker(forwardRefManifest);
    const mfOk = new Miniflare({
      modules: [
        {
          type: 'ESModule',
          path: 'worker.mjs',
          contents: forwardRefCompiled.workerCode,
        },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify({
            title: 'ForwardRef Home',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const okRes = await mfOk.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(okRes.status).toBe(200);
      expect(await okRes.text()).toContain('ForwardRef Home');
    } finally {
      await mfOk.dispose();
    }
  });

  it('blocks ownerDocument.write and local or cross-file aliased executable JSX tags', async () => {
    for (const files of [
      [
        {
          path: 'src/StorefrontApp.tsx',
          content: `export default function X() {
            return <button type="button" onClick={() => { document.body.ownerDocument.write('<b>x</b>'); }}>ok</button>;
          }`,
        },
      ],
      [
        {
          path: 'src/StorefrontApp.tsx',
          content: `export default function X() {
            const Tag = 'script';
            return <Tag src="https://www.googletagmanager.com/gtm.js" />;
          }`,
        },
      ],
      [
        { path: 'src/evil.ts', content: `export const Tag = 'script';` },
        {
          path: 'src/StorefrontApp.tsx',
          content: `import { Tag } from './evil'; export default function X() { return <Tag />; }`,
        },
      ],
    ]) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = files;
      await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
        StorefrontCompilerError
      );
    }

    // Allows hoisted default exports, export-star barrels, and sibling function parameters sharing a component name
    const validHoistedAndScoped = createOgabasseyStorefrontManifest();
    validHoistedAndScoped.files = [
      {
        path: 'src/Card.tsx',
        content: `export default Card;\nexport function Card() { return <div>card</div>; }`,
      },
      {
        path: 'src/barrel.ts',
        content: `export * from './Card';`,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import DefaultCard from './Card';
          import { Card } from './barrel';
          function formatLabel(Card: string) { return Card.toUpperCase(); }
          export default function App() {
            return <main data-l={formatLabel('ok')}><DefaultCard /><Card /></main>;
          }
        `,
      },
    ];
    const okRelease = await compileStorefrontWorker(validHoistedAndScoped);
    expect(okRelease.workerCode.length).toBeGreaterThan(500);
  });

  it('converts schema-invalid catalog JSON to 502 and selects final segment on /:locale/:collectionId', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/search', view: 'search' },
      { path: '/p/:productSlug', view: 'product' },
      { path: '/:locale/:collectionId', view: 'collection' },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    let responseBody = '[]';
    const queriedCategories: string[] = [];

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: (req: MiniflareRequest) => {
        const u = new URL(req.url);
        const cat =
          u.searchParams.get('category') ?? u.searchParams.get('categoryId');
        if (cat !== null) {
          queriedCategories.push(cat);
        }
        return new MiniflareResponse(responseBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    try {
      expect(
        (await mf.dispatchFetch('https://ogabassey.mybaci.store/search?q=x'))
          .status
      ).toBe(502);

      responseBody = JSON.stringify({ error: 'temporary failure' });
      expect(
        (await mf.dispatchFetch('https://ogabassey.mybaci.store/p/sku-1'))
          .status
      ).toBe(502);

      responseBody = JSON.stringify({
        title: 'Smartphones',
        categoryExists: true,
        products: [],
        facets: { brands: [], conditions: [], totalMatches: 0 },
      });
      expect(
        (
          await mf.dispatchFetch(
            'https://ogabassey.mybaci.store/en/smartphones'
          )
        ).status
      ).toBe(200);
      expect(queriedCategories).toEqual(['smartphones']);
    } finally {
      await mf.dispose();
    }
  });
});

import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import {
  isContainedPublicCatalogJson,
  isContainedStorefrontHtml,
} from '../benchmark/catalog-containment-check';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 42 dynamic search params, invalid React return rejection, and allowlisted containment check', () => {
  it('forwards dynamic /search/:q and /search/:brand/:q parameters to /v1/search', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/search/:q', view: 'search' },
      { path: '/search/:brand/:term', view: 'search' },
    ];
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App(props: { view: string; products: Array<{ name: string }> }) {
          return <main data-view={props.view}>{props.products.map((p) => p.name).join('|')}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const seenUrls: string[] = [];
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        seenUrls.push(req.url);
        const u = new URL(req.url);
        const q = u.searchParams.get('q') ?? '';
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          categoryExists: true,
          products:
            q === 'iphone'
              ? [
                  {
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
                    variants: [],
                  },
                ]
              : [],
          facets: { brands: [], conditions: [], totalMatches: 1 },
        });
      },
    });
    try {
      const res1 = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/search/iphone'
      );
      expect(res1.status).toBe(200);
      expect(await res1.text()).toContain('iPhone 16');
      expect(seenUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/search?q=iphone'
      );

      const res2 = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/search/Apple/iphone'
      );
      expect(res2.status).toBe(200);
      expect(seenUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/search?brand=Apple&q=iphone'
      );
    } finally {
      await mf.dispose();
    }
  });

  it('rejects component functions with statically invalid React return expressions', async () => {
    const badEntries = [
      `export default () => ({});`,
      `export default function App() { return { notReact: true }; }`,
      `const obj = { a: 1 };\nexport default () => obj;`,
      `export default () => new Date();`,
      `export default () => new WeakSet();`,
      `export default () => true && ({});`,
      `const BadCard = () => ({ bad: 1 });\nexport default function App() { return <main><BadCard /></main>; }`,
      `import { Component } from 'react';\nexport default class App extends Component { render() { return { bad: 1 }; } }`,
    ];
    for (const content of badEntries) {
      const m = createOgabasseyStorefrontManifest();
      m.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(m)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    // Valid edge cases: destructured param shadowing outer object, Object.entries, new Array, and nested getter
    const validContent = `const products = {};
function Sub({ products }: { products: string[] }) { return products; }
export default function App() {
  const helper = { get meta() { return { ok: true }; } };
  void helper;
  return <main><Sub products={new Array('hi')} />{Object.entries({ a: '1' })}</main>;
}`;
    const validManifest = createOgabasseyStorefrontManifest();
    validManifest.files = [
      { path: 'src/StorefrontApp.tsx', content: validContent },
    ];
    const okCompiled = await compileStorefrontWorker(validManifest);
    expect(okCompiled.workerCode.length).toBeGreaterThan(100);
  });

  it('rejects snake_case private pricing/supplier fields via strict allowlisted containment schemas', () => {
    const validProduct = {
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
      shortSpecs: '128GB',
      variants: [
        {
          id: 'v1',
          label: '128GB',
          priceNgn: 1_500_000,
          inStock: true,
        },
      ],
    };
    const validPayload = {
      merchantId: 'm1',
      generation: 1,
      availabilityGeneration: 1,
      title: 'Featured',
      categoryExists: true,
      products: [validProduct],
      facets: { brands: [], conditions: [], totalMatches: 1 },
    };
    expect(isContainedPublicCatalogJson(JSON.stringify(validPayload))).toBe(
      true
    );

    // Snake_case database spellings & unexpected fields are rejected even without camelCase substrings
    expect(
      isContainedPublicCatalogJson(
        JSON.stringify({
          ...validPayload,
          products: [{ ...validProduct, cost_price: 900_000 }],
        })
      )
    ).toBe(false);
    expect(
      isContainedPublicCatalogJson(
        JSON.stringify({
          ...validPayload,
          products: [
            {
              ...validProduct,
              variants: [{ ...validProduct.variants[0], margin_bps: 1200 }],
            },
          ],
        })
      )
    ).toBe(false);

    const validState = {
      view: 'home',
      pathname: '/',
      workerOrigin: 'https://ogabassey.mybaci.store',
      merchantSlug: 'ogabassey',
      title: 'Home',
      products: [validProduct],
      facets: { brands: [], conditions: [], totalMatches: 1 },
      productDetail: null,
      publicDataRevision: '1:1',
    };
    expect(
      isContainedStorefrontHtml(
        `<!DOCTYPE html><html><body><script id="__BACI_STOREFRONT_STATE__" type="application/json">${JSON.stringify(validState)}</script></body></html>`,
        200
      )
    ).toBe(true);
    expect(
      isContainedStorefrontHtml(
        `<!DOCTYPE html><html><body><script id="__BACI_STOREFRONT_STATE__" type="application/json">${JSON.stringify({ ...validState, products: [{ ...validProduct, wholesale_ngn: 800_000 }] })}</script></body></html>`,
        200
      )
    ).toBe(false);
  });
});

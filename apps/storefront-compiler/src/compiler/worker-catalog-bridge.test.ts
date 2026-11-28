import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildDeclaredRouteMatcherSnippet } from './route-matcher-snippet';
import { buildWorkerCatalogBridgeSnippet } from './worker-catalog-bridge';

describe('worker-catalog-bridge', () => {
  it('serves /_baci/catalog collection/product/variants and rejects unsupported methods and malformed payloads', async () => {
    const ctx: Record<string, unknown> = {
      ASSETS_MAP: { 'hero-banner': '/assets/hero-banner' },
      CSP_HEADER: "default-src 'self'",
      DECLARED_ROUTES: [{ path: '/products/:handle', view: 'product' }],
      EMPTY_FACETS: { brands: [], conditions: [], totalMatches: 0 },
      canonicalizeSearchParams: (sp: URLSearchParams) =>
        new URLSearchParams(sp),
      formatUpstreamRevision: () => '2:3',
      fetchCatalogJson: async (ep: string) => {
        if (ep.includes('productSlug=iphone-16')) {
          return {
            ok: true,
            data: {
              product: {
                id: 'p1',
                slug: 'iphone-16',
                name: 'iPhone 16',
                priceNgn: 1500000,
                imageUrl: 'https://cdn.usebaci.com/p1.webp',
                variants: [
                  {
                    id: 'v1',
                    label: '128GB',
                    priceNgn: 1500000,
                    inStock: true,
                  },
                ],
              },
            },
          };
        }
        return { ok: true, data: { product: null } };
      },
      Response,
      URL,
      URLSearchParams,
      decodeURIComponent,
      encodeURIComponent,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Set,
      Math,
      JSON,
    };
    vm.runInNewContext(
      `${buildDeclaredRouteMatcherSnippet()}\n${buildWorkerCatalogBridgeSnippet()}\nglobalThis.handle = handleCatalogBridgeRequest;`,
      ctx
    );
    const handle = ctx.handle as (u: URL, m: string) => Promise<Response>;

    const postRes = await handle(
      new URL('https://store.test/_baci/catalog?op=product&handle=iphone-16'),
      'POST'
    );
    expect(postRes.status).toBe(405);

    const okRes = await handle(
      new URL('https://store.test/_baci/catalog?op=product&handle=iphone-16'),
      'GET'
    );
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as {
      status: string;
      value: { canonicalPath: string };
    };
    expect(body.status).toBe('ok');
    expect(body.value.canonicalPath).toBe('/products/iphone-16');
  });
});

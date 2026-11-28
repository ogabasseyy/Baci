import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildRouteCatalogLoaderSnippet } from './route-catalog-loader-snippet';
import { buildSsrCatalogProjectionSnippet } from './ssr-catalog-projection';

describe('route-catalog-loader-snippet', () => {
  it('returns 404 on unknown collection categories and mismatched multi-identifier product qualifiers', async () => {
    const calls: string[] = [];
    const ctx: Record<string, unknown> = {
      ASSETS_MAP: {},
      EMPTY_FACETS: { brands: [], conditions: [], totalMatches: 0 },
      isFiniteNumber: (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v),
      canonicalizeSearchParams: (sp: URLSearchParams) =>
        new URLSearchParams(sp),
      formatUpstreamRevision: () => '1:1',
      fetchCatalogJson: async (ep: string, kind: string) => {
        calls.push(ep);
        if (kind === 'collection') {
          return { ok: true, data: { categoryExists: false, products: [] } };
        }
        return {
          ok: true,
          data: {
            product: {
              id: 'p1',
              slug: 'iphone-16',
              sku: 'SKU-REAL',
              name: 'iPhone 16',
              categorySlug: 'smartphones',
              priceNgn: 100,
              inStock: true,
              variants: [
                {
                  id: 'v1',
                  sku: 'SKU-REAL',
                  label: 'Base',
                  priceNgn: 100,
                  inStock: true,
                },
              ],
            },
          },
        };
      },
      URLSearchParams,
      encodeURIComponent,
      Array,
      Object,
      Boolean,
      String,
    };
    vm.runInNewContext(
      `${buildSsrCatalogProjectionSnippet()}\n${buildRouteCatalogLoaderSnippet()}\nglobalThis.load = loadDeclaredRouteCatalog;`,
      ctx
    );
    const load = ctx.load as (
      route: { view: string; params: Record<string, string> } | null,
      sp: URLSearchParams
    ) => Promise<{ status: number; view: string }>;

    const missingCol = await load(
      { view: 'collection', params: { category: 'missing' } },
      new URLSearchParams()
    );
    expect(missingCol.status).toBe(404);

    const wrongCatPdp = await load(
      {
        view: 'product',
        params: { category: 'laptops', productSlug: 'iphone-16' },
      },
      new URLSearchParams()
    );
    expect(wrongCatPdp.status).toBe(404);

    const okPdp = await load(
      {
        view: 'product',
        params: {
          category: 'smartphones',
          productSlug: 'iphone-16',
          variantId: 'v1',
        },
      },
      new URLSearchParams()
    );
    expect(okPdp.status).toBe(200);
    expect(calls.length).toBe(3);
  });
});

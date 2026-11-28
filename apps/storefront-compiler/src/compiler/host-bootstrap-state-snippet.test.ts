import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildHostBootstrapStateSnippet } from './host-bootstrap-state-snippet';
import { buildDeclaredRouteMatcherSnippet } from './route-matcher-snippet';

describe('host-bootstrap-state-snippet', () => {
  it('merges cached card enrichment fields across narrow host bootstrap updates and resolves PDP routes', () => {
    const ctx: Record<string, unknown> = {
      ASSETS_MAP: {},
      DECLARED_ROUTES: [
        { path: '/', view: 'home' },
        { path: '/products/[handle]', view: 'product' },
      ],
      URL,
      decodeURIComponent,
      Array,
      Object,
      Map,
      Set,
      String,
      Boolean,
      Math,
    };
    vm.runInNewContext(
      `${buildDeclaredRouteMatcherSnippet()}\n${buildHostBootstrapStateSnippet()}\nglobalThis.remember = rememberEnrichedProducts; globalThis.derive = deriveNextRenderProps;`,
      ctx
    );
    const cache = new Map();
    const initial = {
      view: 'home',
      pathname: '/',
      title: 'Home',
      products: [
        {
          id: 'p1',
          slug: 'iphone-16',
          name: 'iPhone 16',
          brand: 'Apple',
          condition: 'New',
          shortSpecs: 'A18 chip',
          priceNgn: 1500000,
          inStock: true,
          variants: [
            { id: 'v1', label: '128GB', priceNgn: 1500000, inStock: true },
          ],
        },
      ],
      facets: {
        brands: [{ value: 'Apple', count: 1 }],
        conditions: [],
        totalMatches: 1,
      },
      productDetail: null,
      publicDataRevision: '1:1',
    };
    (ctx.remember as (c: unknown, s: unknown) => void)(cache, initial);
    const next = (
      ctx.derive as (
        prev: unknown,
        r: unknown,
        cat: unknown,
        assets: unknown,
        c: unknown
      ) => Record<string, unknown>
    )(
      initial,
      {
        epoch: 2,
        routeId: 'product',
        canonicalPath: '/products/iphone-16',
        params: { handle: 'iphone-16' },
        publicDataRevision: '1:2',
      },
      {
        products: [
          {
            id: 'p1',
            slug: 'iphone-16',
            name: 'iPhone 16',
            price: 1500000,
            available: false,
            variants: [],
          },
        ],
      },
      {},
      cache
    );
    expect(next.view).toBe('product');
    expect((next.productDetail as Record<string, unknown>)?.brand).toBe(
      'Apple'
    );
    expect((next.productDetail as Record<string, unknown>)?.inStock).toBe(
      false
    );
  });
});

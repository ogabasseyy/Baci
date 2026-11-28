import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildHostBootstrapStateSnippet } from './host-bootstrap-state-snippet';
import { buildRouteEnrichmentSnippet } from './route-enrichment-snippet';
import { buildDeclaredRouteMatcherSnippet } from './route-matcher-snippet';

describe('route-enrichment-snippet', () => {
  it('binds query strings to settled navigation epochs and enriches route state via /_baci/catalog?op=route', async () => {
    const requestedUrls: string[] = [];
    const applied: Record<string, unknown>[] = [];
    const ctx: Record<string, unknown> = {
      ASSETS_MAP: {},
      DECLARED_ROUTES: [{ path: '/collections/[handle]', view: 'collection' }],
      hostEpoch: 1,
      lastHostBootstrap: null,
      fetch: async (url: string) => {
        requestedUrls.push(url);
        return {
          json: async () => ({
            status: 'ok',
            value: {
              view: 'collection',
              title: 'Phones',
              products: [
                {
                  id: 'p1',
                  slug: 's1',
                  name: 'Phone',
                  brand: 'Apple',
                  priceNgn: 100,
                  inStock: true,
                  variants: [],
                },
              ],
              facets: {
                brands: [{ value: 'Apple', count: 1 }],
                conditions: [],
                totalMatches: 1,
              },
              productDetail: null,
            },
          }),
        };
      },
      URL,
      decodeURIComponent,
      encodeURIComponent,
      Number,
      Array,
      Object,
      Map,
      Set,
      String,
      Boolean,
      Math,
      Promise,
    };
    vm.runInNewContext(
      `${buildDeclaredRouteMatcherSnippet()}\n${buildHostBootstrapStateSnippet()}\n${buildRouteEnrichmentSnippet()}\nglobalThis.createEnricher = createRouteEnricher;`,
      ctx
    );
    let state = {
      props: {
        pathname: '/collections/phones',
        view: 'collection',
        title: 'Col',
      },
      epoch: 2,
    };
    let resolveApplied!: () => void;
    const appliedDone = new Promise<void>((r) => {
      resolveApplied = r;
    });
    const enricher = (
      ctx.createEnricher as (
        init: unknown,
        assets: unknown,
        cache: unknown,
        getS: () => unknown,
        apply: (next: Record<string, unknown>) => void
      ) => {
        (p: string, ep: number, boot: unknown): boolean;
        createNavHooks: (
          p: string,
          s: string
        ) => {
          onSend: () => unknown;
          onSettle: (slot: unknown, res: unknown) => void;
        };
      }
    )(
      { workerOrigin: 'https://worker.test', pathname: '/' },
      {},
      new Map(),
      () => state,
      (next) => {
        state = { props: next as typeof state.props, epoch: 2 };
        applied.push(next);
        resolveApplied();
      }
    );
    const hooks = enricher.createNavHooks(
      '/collections/phones',
      '?brand=Apple'
    );
    const slot = hooks.onSend();
    hooks.onSettle(slot, { status: 'ok', value: { epoch: 2 } });
    enricher('/collections/phones', 2, null);
    await appliedDone;
    expect(requestedUrls[0]).toContain(
      encodeURIComponent('/collections/phones?brand=Apple')
    );
    expect(applied).toHaveLength(1);
  });
});

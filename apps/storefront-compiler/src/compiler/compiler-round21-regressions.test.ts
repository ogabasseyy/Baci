import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 21 compiler & runtime regressions', () => {
  it('blocks runtime mutations of anchor/form/media/URL-decomposition and imperative style properties on refs', async () => {
    const snippets = [
      `ref.current.href = 'https://evil.example';`,
      `ref.current['href'] = 'https://evil.example';`,
      `ref.current.hostname = 'evil.example';`,
      `ref.current.protocol = 'javascript:';`,
      `ref.current.formAction = 'https://evil.example/post';`,
      `[ref.current.href] = ['https://evil.example'];`,
      `({ target: ref.current.href } = { target: 'https://evil.example' });`,
      `ref.current.style.backgroundImage = 'url(https://evil.example/p.png)';`,
      `ref.current.style.setProperty('background-image', 'url(https://evil.example)');`,
    ];

    for (const stmt of snippets) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [
        {
          path: 'src/StorefrontApp.tsx',
          content: `
            import { useEffect, useRef } from 'react';
            export default function StorefrontApp() {
              const ref = useRef<any>(null);
              useEffect(() => { ${stmt} }, []);
              return <main><a ref={ref} href="/cart">Cart</a></main>;
            }
          `,
        },
      ];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    // Legitimate JSX href/style props and plain prop reads still compile cleanly
    const clean = createOgabasseyStorefrontManifest();
    clean.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          export default function StorefrontApp(props: { pathname: string; item?: { href?: string } }) {
            const label = props.item?.href ?? props.pathname;
            return <main style={{ color: '#111' }}><a href="/cart">{label}</a></main>;
          }
        `,
      },
    ];
    const built = await compileStorefrontWorker(clean);
    expect(built.workerCode.length).toBeGreaterThan(0);
  });

  it('refuses checkout.open before cart enrollment and resolves destination RouteState in navigation.go', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/:category', view: 'collection' },
      { path: '/search', view: 'search' },
      { path: '/cart', view: 'cart' },
      { path: '/:category/:productSlug', view: 'product' },
    ]);

    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown; code?: string }>)
      | undefined;
    const assignedUrls: string[] = [];

    const stubModuleBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = "CommerceProvider"; const createCommerceClient = (fn) => { __capture(fn); return fn; };'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = () => ({}); const useEffect = () => {};'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => {};'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );

    const win: Record<string, unknown> = {
      location: {
        origin: 'https://ogabassey.mybaci.store',
        assign: (u: string) => assignedUrls.push(u),
      },
    };
    win.parent = win;

    vm.runInNewContext(stubModuleBody, {
      URL,
      __capture: (fn: typeof capturedTransport) => {
        capturedTransport = fn;
      },
      window: win,
      document: {
        getElementById: (id: string) =>
          id === 'root'
            ? {}
            : {
                textContent: JSON.stringify({
                  view: 'home',
                  merchantSlug: 'ogabassey',
                  publicDataRevision: '42:7',
                }),
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    if (!capturedTransport) throw new Error('Expected transport');

    // checkout.open must fail closed with CART_ENROLLMENT_REQUIRED
    const checkoutOpen = await capturedTransport('checkout.open', {});
    expect(checkoutOpen).toMatchObject({
      status: 'error',
      code: 'CART_ENROLLMENT_REQUIRED',
    });
    expect(assignedUrls).toHaveLength(0);

    // Static /search route beats earlier /:category and returns destination state
    const navSearch = await capturedTransport('navigation.go', {
      path: '/search?q=iphone',
    });
    expect(navSearch).toEqual({
      status: 'ok',
      value: {
        epoch: 2,
        routeId: 'search',
        params: {},
        canonicalPath: '/search?q=iphone',
        publicDataRevision: '42:7',
      },
    });

    // Dynamic /:category/:productSlug populates destination routeId + params + incremented epoch
    const navProd = await capturedTransport('navigation.go', {
      path: '/smartphones/iphone-16',
    });
    expect(navProd).toEqual({
      status: 'ok',
      value: {
        epoch: 3,
        routeId: 'product',
        params: { category: 'smartphones', productSlug: 'iphone-16' },
        canonicalPath: '/smartphones/iphone-16',
        publicDataRevision: '42:7',
      },
    });

    // Undeclared destination fails with NOT_FOUND without assigning location
    const prevLen = assignedUrls.length;
    const navMissing = await capturedTransport('navigation.go', {
      path: '/a/b/c/undeclared',
    });
    expect(navMissing).toMatchObject({ status: 'error', code: 'NOT_FOUND' });
    expect(assignedUrls).toHaveLength(prevLen);
  });

  it('prefers static routes over earlier dynamic routes in SSR and rejects non-boolean variant availability with 502', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    // Deliberately place dynamic /:category BEFORE static /cart and /search
    manifest.routes = [
      { path: '/:category', view: 'collection' },
      { path: '/cart', view: 'cart' },
      { path: '/search', view: 'search' },
      { path: '/', view: 'home' },
      { path: '/:category/:productSlug', view: 'product' },
    ];
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          export default function StorefrontApp(props: { view: string; title: string }) {
            return <main data-view={props.view}><h1>{props.title}</h1></main>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    let malformedVariant = false;

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        const u = new URL(req.url);
        if (u.pathname === '/v1/product') {
          return Response.json({
            generation: 5,
            availabilityGeneration: 9,
            product: {
              id: 'prod_1',
              slug: 'iphone-16',
              name: 'iPhone 16',
              priceNgn: 950000,
              variants: [
                {
                  id: 'var_1',
                  label: '128GB',
                  priceNgn: 950000,
                  inStock: malformedVariant ? 'false' : false,
                },
              ],
            },
          });
        }
        return Response.json({
          generation: 5,
          availabilityGeneration: 9,
          categoryExists: true,
          products: [],
          facets: { brands: [], conditions: [], totalMatches: 0 },
        });
      },
    });

    try {
      const cartRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/cart'
      );
      expect(cartRes.status).toBe(200);
      const cartHtml = await cartRes.text();
      expect(cartHtml).toContain('data-view="cart"');

      const searchRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/search'
      );
      expect(searchRes.status).toBe(200);
      const searchHtml = await searchRes.text();
      expect(searchHtml).toContain('data-view="search"');
      expect(searchHtml).toContain('"publicDataRevision":"5:9"');

      // Valid boolean false availability succeeds
      const okProd = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=smartphones/iphone-16'
      );
      expect(okProd.status).toBe(200);
      const okBody = (await okProd.json()) as { value: { available: boolean } };
      expect(okBody.value.available).toBe(false);

      // Malformed string "false" availability must fail closed with 502 (both SSR & bridge)
      malformedVariant = true;
      const badBridge = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=smartphones/iphone-16'
      );
      expect(badBridge.status).toBe(502);

      const badSsr = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/iphone-16'
      );
      expect(badSsr.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });
});

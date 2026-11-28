import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 28 compiler & runtime regressions', () => {
  it('requires verified @baci/experience-sdk bindings for .open() and rejects non-component package exports', async () => {
    const invalidSources = [
      `export default function X() { return <button type="button" onClick={(e) => { const box = { navigation: e.nativeEvent.view }; box.navigation.open('https://evil.example'); }}>x</button>; }`,
      `const useCommerce = () => ({ navigation: (0 as any) });\nexport default function X() { return <button type="button" onClick={() => { useCommerce().navigation.open('https://evil.example'); }}>x</button>; }`,
      `import React from 'react';\nexport default React;`,
      `import { Children } from 'react';\nexport default Children;`,
    ];
    for (const content of invalidSources) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    const validManifest = createOgabasseyStorefrontManifest();
    validManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { useCommerce } from '@baci/experience-sdk';\nexport default function App() { const c = useCommerce(); const { navigation, checkout } = c; return <main><button type="button" onClick={() => { void navigation.open('/smartphones'); }}>Go</button><button type="button" onClick={() => { void checkout.open(); }}>Pay</button></main>; }`,
      },
    ];
    const compiled = await compileStorefrontWorker(validManifest);
    expect(compiled.workerCode.length).toBeGreaterThan(100);
  });

  it('propagates host bootstrap and route updates into the hydrated React tree and honors form submitter overrides', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/search', view: 'search' },
      { path: '/:category', view: 'collection' },
      { path: '/:category/:productSlug', view: 'product' },
    ]);

    let messageListener: ((event: unknown) => void) | undefined;
    const snapshots: Record<string, unknown>[] = [];
    const assetsLog: Record<string, string>[] = [];
    const rootListeners = new Map<
      string,
      (ev: Record<string, unknown>) => void
    >();
    const parentFrame = {};

    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => { __assets(p.assets); return p.children; }; const createCommerceClient = (s) => ({ navigation: { go: (path) => s("navigation.go", { path }), open: (path) => s("navigation.open", { path }) }, checkout: { open: () => s("checkout.open", {}) } });'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = (t, p, ...c) => (typeof t === "function" ? t({ ...(p || {}), children: c }) : {}); const useEffect = (fn) => { __captureCommit(fn); };'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = (_el, tree) => ({ render: (next) => { void next; } });'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = await new Promise((r) => { __resolveImport(() => r({ default: (p) => { __props(p); return null; } })); });'
      );

    let finishImport: (() => void) | undefined;
    let commitHydration: (() => void) | undefined;
    vm.runInNewContext(stubBody, {
      URL,
      URLSearchParams,
      __resolveImport: (fn: () => void) => {
        finishImport = fn;
      },
      __captureCommit: (fn: () => void) => {
        commitHydration = fn;
      },
      __props: (p: Record<string, unknown>) => snapshots.push(p),
      __assets: (a: Record<string, string>) => assetsLog.push({ ...a }),
      window: {
        location: { origin: 'null', assign: () => {} },
        parent: parentFrame,
        addEventListener: (t: string, cb: (ev: unknown) => void) => {
          if (t === 'message') messageListener = cb;
        },
        removeEventListener: () => {},
      },
      document: {
        getElementById: (id: string) =>
          id === 'root'
            ? {
                addEventListener: (
                  t: string,
                  cb: (ev: Record<string, unknown>) => void
                ) => rootListeners.set(t, cb),
              }
            : {
                textContent:
                  '{"view":"home","pathname":"/","merchantSlug":"ogabassey","title":"Featured Devices","products":[],"facets":{"brands":[],"conditions":[],"totalMatches":0},"productDetail":null,"publicDataRevision":"1:1"}',
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(snapshots).toHaveLength(0);

    const sent: Record<string, unknown>[] = [];
    const mockPort: {
      onmessage: ((e: { data: unknown }) => void) | null;
      start: () => void;
      postMessage: (msg: Record<string, unknown>) => void;
    } = {
      onmessage: null,
      start: () => {},
      postMessage: (msg) => {
        sent.push(msg);
        if (msg.protocol === 'baci-commerce/1') {
          const val =
            msg.method === 'navigation.go'
              ? {
                  epoch: 3,
                  routeId: 'search',
                  params: {},
                  canonicalPath: '/search',
                  publicDataRevision: '2:1',
                }
              : { presented: true };
          mockPort.onmessage?.({
            data: {
              type: 'result',
              requestId: msg.requestId,
              result: { status: 'ok', value: val },
            },
          });
        }
      },
    };

    messageListener?.({
      source: parentFrame,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-28',
        instanceId: 'inst-28',
        buildDigest: 'f'.repeat(64),
      },
      ports: [mockPort],
    });

    mockPort.onmessage?.({
      data: {
        type: 'bootstrap',
        bootstrap: {
          assets: { 'img-16': 'https://cdn.usebaci.com/iphone-16.png' },
          route: {
            epoch: 2,
            routeId: 'collection',
            params: { category: 'smartphones' },
            canonicalPath: '/smartphones',
            publicDataRevision: '2:1',
          },
          catalog: {
            revision: '2:1',
            products: [
              {
                id: 'p16',
                slug: 'iphone-16',
                name: 'iPhone 16 Pro',
                price: 1_500_000,
                currency: 'NGN',
                available: true,
                canonicalPath: '/smartphones/iphone-16',
                image: { assetId: 'img-16', alt: 'iPhone 16 Pro' },
                variants: [{ id: 'v1', label: '256GB', available: true }],
              },
            ],
          },
          capabilities: ['catalog.read', 'navigation'],
        },
      },
    });
    mockPort.onmessage?.({
      data: {
        type: 'route',
        route: {
          epoch: 3,
          routeId: 'product',
          params: { category: 'smartphones', productSlug: 'iphone-16' },
          canonicalPath: '/smartphones/iphone-16',
          publicDataRevision: '2:1',
        },
      },
    });
    finishImport?.();
    await new Promise((r) => setImmediate(r));
    // Initial hydrateRoot renders SSR initialProps first (deferring cached host rerender until commit!)
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.view).toBe('home');
    commitHydration?.();
    expect(assetsLog.at(-1)?.['img-16']).toBe(
      'https://cdn.usebaci.com/iphone-16.png'
    );
    expect(snapshots.at(-1)).toMatchObject({
      view: 'product',
      pathname: '/smartphones/iphone-16',
      title: 'iPhone 16 Pro',
      productDetail: { slug: 'iphone-16' },
    });

    let dialogPrevented = false;
    rootListeners.get('submit')?.({
      type: 'submit',
      defaultPrevented: false,
      preventDefault: () => {
        dialogPrevented = true;
      },
      target: { getAttribute: () => null, elements: [] },
      submitter: {
        getAttribute: (k: string) => (k === 'formmethod' ? 'dialog' : null),
      },
    });
    expect(dialogPrevented).toBe(false);
  });

  it('bounds catalog response bytes before JSON parsing and rejects negative/fractional facet counts with 502', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    let mode: 'oversized' | 'badFacet' | 'badTotal' = 'oversized';
    const base = 'https://ogabassey.mybaci.store/';

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService() {
        if (mode === 'oversized') {
          return Response.json({
            generation: 1,
            availabilityGeneration: 1,
            products: [
              {
                id: 'p1',
                slug: 'iphone-16',
                name: 'iPhone 16',
                priceNgn: 900_000,
                inStock: true,
                extraPad: 'x'.repeat(300_000),
                variants: [
                  {
                    id: 'v1',
                    label: '128GB',
                    priceNgn: 900_000,
                    inStock: true,
                  },
                ],
              },
            ],
            facets: { brands: [], conditions: [], totalMatches: 1 },
          });
        }
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          products: [],
          facets: {
            brands: mode === 'badFacet' ? [{ value: 'Apple', count: -3 }] : [],
            conditions: [],
            totalMatches: mode === 'badTotal' ? 1.5 : 0,
          },
        });
      },
    });

    try {
      expect((await mf.dispatchFetch(base)).status).toBe(502);
      mode = 'badFacet';
      expect((await mf.dispatchFetch(base)).status).toBe(502);
      mode = 'badTotal';
      expect((await mf.dispatchFetch(base)).status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });
});

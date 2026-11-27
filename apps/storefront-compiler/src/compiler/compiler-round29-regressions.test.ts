import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 29 compiler & runtime regressions', () => {
  it('blocks aliased, bound, callback-passed, and destructured .open escapes while preserving boolean open props', async () => {
    const escapes = [
      `export default function X() { return <button type="button" onClick={(e) => { const launch = e.nativeEvent.view.open.bind(e.nativeEvent.view); launch('https://evil.example'); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(a: any) => { const launch = a[0].open; launch('https://evil.example'); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(a: any) => { ['https://evil.example'].forEach(a[0].open); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e: any) => { const { open } = e.nativeEvent.view; open('https://evil.example'); }}>x</button>; }`,
      `function Evil({ open }: { open: any }) { open('https://evil.example'); return null; }\nexport default function X() { return <Evil open={true} />; }`,
    ];

    for (const content of escapes) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    const safeManifest = createOgabasseyStorefrontManifest();
    safeManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import { useState } from 'react';
          function Sheet({ open }: { open: boolean }) {
            const fmt = (open: string) => open.toUpperCase();
            return open ? <div>{fmt('Visible')}</div> : null;
          }
          export default function StorefrontApp() {
            const [open, setOpen] = useState(true);
            return <main><button type="button" onClick={() => setOpen(!open)}>Toggle</button><Sheet open={open} /></main>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(safeManifest);
    expect(compiled.workerCode.length).toBeGreaterThan(100);
  });

  it('preserves enriched SSR brand/condition/shortSpecs/facets across narrow host bootstrap, defers rerender until commit, and waits 10s on host bridge', async () => {
    vi.useFakeTimers();
    try {
      const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
        { path: '/', view: 'home' },
        { path: '/:category', view: 'collection' },
      ]);

      let messageListener: ((event: unknown) => void) | undefined;
      let capturedTransport:
        | ((
            method: string,
            args: Record<string, unknown>
          ) => Promise<{ status: string; value?: unknown; code?: string }>)
        | undefined;
      let commitEffect: (() => void) | undefined;
      let finishImport: (() => void) | undefined;
      let renderCount = 0;
      const renderedProps: Record<string, unknown>[] = [];
      const parentFrame = {};

      const stubBody = entrySrc
        .replace(
          "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
          'const CommerceProvider = (p) => p.children; const createCommerceClient = (fn) => { __captureTransport(fn); return fn; };'
        )
        .replace(
          "import { createElement, useEffect } from 'react';",
          'const createElement = (t, p, ...c) => (typeof t === "function" ? t({ ...(p || {}), children: c }) : {}); const useEffect = (fn) => { __captureCommit(fn); };'
        )
        .replace(
          "import { hydrateRoot } from 'react-dom/client';",
          'const hydrateRoot = () => ({ render: () => { __onRender(); } });'
        )
        .replace(
          'const mod = await import("./src/App.tsx");',
          'const mod = await new Promise((r) => { __resolveImport(() => r({ default: (p) => { __recordProps(p); return null; } })); });'
        );

      vm.runInNewContext(stubBody, {
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        __captureTransport: (fn: typeof capturedTransport) => {
          capturedTransport = fn;
        },
        __captureCommit: (fn: () => void) => {
          commitEffect = fn;
        },
        __resolveImport: (fn: () => void) => {
          finishImport = fn;
        },
        __onRender: () => {
          renderCount++;
        },
        __recordProps: (p: Record<string, unknown>) => {
          renderedProps.push(p);
        },
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
              ? { addEventListener: () => {} }
              : {
                  textContent: JSON.stringify({
                    view: 'home',
                    pathname: '/',
                    merchantSlug: 'ogabassey',
                    title: 'Ogabassey Verified Flagships',
                    products: [
                      {
                        id: 'p1',
                        slug: 'iphone-15-used',
                        name: 'iPhone 15 Pro (UK Used)',
                        categorySlug: 'smartphones',
                        brand: 'Apple',
                        condition: 'Used',
                        priceNgn: 950_000,
                        inStock: true,
                        imageUrl: 'https://cdn.usebaci.com/p1.webp',
                        imageAlt: 'iPhone 15 Pro',
                        shortSpecs: '256GB · Physical SIM · 94% Battery',
                        variants: [],
                      },
                    ],
                    facets: {
                      brands: [{ value: 'Apple', count: 1 }],
                      conditions: [{ value: 'Used', count: 1 }],
                      totalMatches: 1,
                    },
                    productDetail: null,
                    publicDataRevision: '1:1',
                  }),
                },
        },
      });

      const pendingRequests: Record<string, unknown>[] = [];
      const mockPort: {
        onmessage: ((e: { data: unknown }) => void) | null;
        start: () => void;
        postMessage: (msg: Record<string, unknown>) => void;
      } = {
        onmessage: null,
        start: () => {},
        postMessage: (msg) => {
          if (msg.protocol === 'baci-commerce/1') pendingRequests.push(msg);
        },
      };

      messageListener?.({
        source: parentFrame,
        origin: 'https://usebaci.com',
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-29',
          instanceId: 'inst-29',
          buildDigest: 'a'.repeat(64),
        },
        ports: [mockPort],
      });

      // Host sends narrow PublicBootstrap (omitting brand/condition/shortSpecs/facets) BEFORE import resolves
      mockPort.onmessage?.({
        data: {
          type: 'bootstrap',
          bootstrap: {
            route: {
              epoch: 1,
              routeId: 'home',
              params: {},
              canonicalPath: '/',
              publicDataRevision: '1:1',
            },
            catalog: {
              revision: '1:1',
              products: [
                {
                  id: 'p1',
                  slug: 'iphone-15-used',
                  name: 'iPhone 15 Pro (UK Used)',
                  price: 950_000,
                  currency: 'NGN',
                  available: true,
                  image: null,
                  variants: [],
                },
              ],
            },
            capabilities: ['catalog.read', 'navigation'],
          },
        },
      });

      finishImport?.();
      await Promise.resolve();
      await Promise.resolve();

      // Before HydrationCommitGate commits, root.render() MUST NOT have been called!
      expect(renderCount).toBe(0);
      expect(renderedProps).toHaveLength(1);

      // Commit hydration: queued bootstrap flushes WITHOUT losing Used condition, Apple brand, shortSpecs, or facets!
      commitEffect?.();
      expect(renderCount).toBe(1);
      const postCommit = renderedProps.at(-1) as {
        title: string;
        products: Record<string, unknown>[];
        facets: { brands: unknown[]; conditions: unknown[] };
      };
      expect(postCommit.title).toBe('Ogabassey Verified Flagships');
      expect(postCommit.products[0]).toMatchObject({
        brand: 'Apple',
        condition: 'Used',
        shortSpecs: '256GB · Physical SIM · 94% Battery',
        imageUrl: 'https://cdn.usebaci.com/p1.webp',
      });
      expect(postCommit.facets).toEqual({
        brands: [{ value: 'Apple', count: 1 }],
        conditions: [{ value: 'Used', count: 1 }],
        totalMatches: 1,
      });

      // Replacement empty catalog clears stale facet counts instead of keeping Apple (1)
      mockPort.onmessage?.({
        data: {
          type: 'bootstrap',
          bootstrap: {
            route: {
              epoch: 2,
              routeId: 'home',
              params: {},
              canonicalPath: '/',
              publicDataRevision: '2:1',
            },
            catalog: { revision: '2:1', products: [] },
            capabilities: ['catalog.read', 'navigation'],
          },
        },
      });
      expect((renderedProps.at(-1) as { facets: unknown }).facets).toEqual({
        brands: [],
        conditions: [],
        totalMatches: 0,
      });

      // Owned navigation taking 6 seconds (> 4s, < 8s/10s) must NOT time out prematurely!
      if (!capturedTransport) throw new Error('Expected transport');
      const navPromise = capturedTransport('navigation.go', {
        path: '/smartphones',
      });
      await vi.advanceTimersByTimeAsync(6000);
      const navReq = pendingRequests.at(-1);
      mockPort.onmessage?.({
        data: {
          type: 'result',
          requestId: navReq?.requestId,
          result: {
            status: 'ok',
            value: {
              epoch: 3,
              routeId: 'collection',
              params: { category: 'smartphones' },
              canonicalPath: '/smartphones',
              publicDataRevision: '3:1',
            },
          },
        },
      });
      await expect(navPromise).resolves.toMatchObject({
        status: 'ok',
        value: { epoch: 3, canonicalPath: '/smartphones' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

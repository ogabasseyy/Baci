import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 44 SDK query navigation, categoryId separation, and motion prop/element safety', () => {
  it('blocks <motion.a> and navigation/resource attributes inside Framer Motion animation props', async () => {
    const escapes = [
      `import { motion } from 'framer-motion';\nexport default function App() { return <motion.a href="/smartphones" animate={{ href: 'https://evil.example' }}>Go</motion.a>; }`,
      `import { motion } from 'framer-motion';\nexport default function App() { return <motion.a href="/smartphones">Go</motion.a>; }`,
      `import { motion } from 'framer-motion';\nexport default function App() { return <motion.div animate={{ href: 'https://evil.example' }}>Box</motion.div>; }`,
      `import { motion } from 'framer-motion';\nexport default function App() { return <motion.div animate={{ backgroundImage: 'url("https://evil.example/track.png")' }}>Box</motion.div>; }`,
    ];
    for (const content of escapes) {
      const m = createOgabasseyStorefrontManifest();
      m.packages = [{ name: 'framer-motion', versionRef: 'platform-pinned' }];
      m.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(m)).rejects.toThrow(
        StorefrontCompilerError
      );
    }
  });

  it('normalizes framed commerce.navigation.go("/search?q=iphone") to pathname while retaining query for enrichment', async () => {
    const entrySrc = buildClientHydrationEntrySource(
      'src/App.tsx',
      {},
      [
        { path: '/', view: 'home' },
        { path: '/search', view: 'search' },
      ],
      undefined,
      'https://ogabassey.usebaci.com'
    );

    interface CapturedCommerce {
      navigation: {
        go: (p: string) => Promise<{ status: string }>;
        open: (p: string) => Promise<{ status: string }>;
      };
    }
    const holder: { commerce?: CapturedCommerce } = {};
    const winMessages: ((ev: unknown) => void)[] = [];
    const sentToHost: Record<string, unknown>[] = [];
    const fetchedUrls: string[] = [];

    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => p.children; const createCommerceClient = (transport) => { const c = { navigation: { go: (path) => transport("navigation.go", { path }), open: (path) => transport("navigation.open", { path }) }, checkout: { open: () => transport("checkout.open", {}) } }; __captureCommerce(c); return c; };'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = () => ({}); const useEffect = (fn) => { fn(); };'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => ({ render: () => {} });'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );

    const parentFrame = {};
    vm.runInNewContext(stubBody, {
      URL,
      URLSearchParams,
      WeakSet,
      AbortController,
      setTimeout,
      clearTimeout,
      __captureCommerce: (c: CapturedCommerce) => {
        holder.commerce = c;
      },
      fetch: async (url: string) => {
        fetchedUrls.push(url);
        return {
          json: async () => ({
            status: 'ok',
            value: {
              view: 'search',
              title: 'Search: iphone',
              products: [],
              facets: { brands: [], conditions: [], totalMatches: 0 },
            },
          }),
        };
      },
      window: {
        location: { origin: 'null', assign: () => {} },
        parent: parentFrame,
        addEventListener: (t: string, cb: (ev: unknown) => void) => {
          if (t === 'message') winMessages.push(cb);
        },
      },
      document: {
        baseURI: 'https://ogabassey.mybaci.store/',
        getElementById: (id: string) =>
          id === 'root'
            ? { addEventListener: () => {} }
            : {
                textContent:
                  '{"view":"home","pathname":"/","workerOrigin":"https://ogabassey.mybaci.store","merchantSlug":"ogabassey","publicDataRevision":"1:1"}',
              },
      },
    });
    await new Promise((r) => setImmediate(r));

    const fakePort: {
      onmessage: ((e: { data: unknown }) => void) | null;
      start: () => void;
      postMessage: (msg: Record<string, unknown>) => void;
    } = {
      onmessage: null,
      start: () => {},
      postMessage: (msg: Record<string, unknown>) => {
        sentToHost.push(msg);
        if (msg.protocol === 'baci-commerce/1') {
          setImmediate(() => {
            fakePort.onmessage?.({
              data: {
                type: 'result',
                requestId: msg.requestId,
                result:
                  msg.method === 'navigation.open'
                    ? { status: 'ok', value: { presented: true } }
                    : {
                        status: 'ok',
                        value: {
                          epoch: 2,
                          routeId: 'search',
                          params: {},
                          canonicalPath: '/search',
                          publicDataRevision: '1:1',
                        },
                      },
              },
            });
            if (msg.method === 'navigation.go') {
              fakePort.onmessage?.({
                data: {
                  type: 'bootstrap',
                  bootstrap: {
                    route: {
                      epoch: 2,
                      routeId: 'search',
                      params: {},
                      canonicalPath: '/search',
                      publicDataRevision: '1:1',
                    },
                    catalog: { products: [] },
                  },
                },
              });
            }
          });
        }
      },
    };
    for (const fn of winMessages) {
      fn({
        origin: 'https://ogabassey.usebaci.com',
        source: parentFrame,
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-44',
          instanceId: 'inst-44',
          buildDigest: 'b'.repeat(64),
        },
        ports: [fakePort],
      });
    }
    expect(holder.commerce).toBeDefined();
    const goRes = await holder.commerce?.navigation.go('/search?q=iphone');
    expect(goRes?.status).toBe('ok');
    const openRes = await holder.commerce?.navigation.open('/search?q=iphone');
    expect(openRes?.status).toBe('ok');
    await new Promise((r) => setImmediate(r));

    const navRequests = sentToHost.filter(
      (m) => m.protocol === 'baci-commerce/1'
    );
    expect(navRequests).toHaveLength(2);
    expect(navRequests[0]).toMatchObject({
      method: 'navigation.go',
      args: { path: '/search' },
    });
    expect(navRequests[1]).toMatchObject({
      method: 'navigation.open',
      args: { path: '/search' },
    });
    expect(fetchedUrls).toContain(
      'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2Fsearch%3Fq%3Diphone'
    );
  });

  it('validates :categoryId against candidate.categoryId (not categorySlug) and returns 404 on mismatch', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/c/:categoryId/:productSlug', view: 'product' },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService() {
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          product: {
            id: 'p1',
            slug: 'iphone-16',
            name: 'iPhone 16',
            categorySlug: 'smartphones',
            categoryId: 'cat-uuid-111',
            brand: 'Apple',
            condition: 'New',
            priceNgn: 1_500_000,
            inStock: true,
            imageUrl: 'https://cdn.usebaci.com/ip16.webp',
            imageAlt: 'iPhone 16',
            variants: [],
          },
        });
      },
    });
    try {
      const okRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/c/cat-uuid-111/iphone-16'
      );
      expect(okRes.status).toBe(200);

      const slugSentAsId = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/c/smartphones/iphone-16'
      );
      expect(slugSentAsId.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });
});

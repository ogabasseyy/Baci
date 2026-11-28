import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it, vi } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 36 route-transition enrichment, verified HOCs, _blank host open, filter-only collections, and :sku matching', () => {
  it('hydrates enriched brand/condition/shortSpecs/facets via /_baci/catalog?op=route on route-changing narrow bootstraps and matches :sku routes', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/:category', view: 'collection' },
      { path: '/brands/:brand', view: 'collection' },
      { path: '/conditions/:condition', view: 'collection' },
      { path: '/sku/:sku', view: 'product' },
    ];
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App(props: { view: string; title: string; products: Array<{ name: string; brand: string; condition: string }>; productDetail?: { name: string; sku?: string } | null }) {
          return <main data-view={props.view} data-title={props.title} data-sku={props.productDetail?.sku ?? ''}>{props.products.map((p) => \`\${p.name}:\${p.brand}:\${p.condition}\`).join('|')}{props.productDetail?.name ?? ''}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const macbook = {
      id: 'p_mac',
      slug: 'macbook-pro-16',
      sku: 'MBP16-M4-BLK',
      name: 'MacBook Pro 16',
      categorySlug: 'laptops',
      brand: 'Apple',
      condition: 'New',
      shortSpecs: 'M4 Max · 48GB · 1TB',
      priceNgn: 3_500_000,
      inStock: true,
      imageUrl: 'https://cdn.usebaci.com/mbp16.webp',
      imageAlt: 'MacBook Pro 16',
      variants: [
        {
          id: 'v_mac',
          sku: 'MBP16-M4-BLK',
          label: '1TB',
          priceNgn: 3_500_000,
          inStock: true,
        },
      ],
    };

    const seenOutboundUrls: string[] = [];
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        seenOutboundUrls.push(req.url);
        if (req.url.includes('/v1/product')) {
          const u = new URL(req.url);
          const match = u.searchParams.get('sku') === 'MBP16-M4-BLK';
          return Response.json({
            generation: 1,
            availabilityGeneration: 1,
            product: match ? macbook : null,
          });
        }
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          categoryExists: !req.url.includes('category=Apple'),
          products: [macbook],
          facets: {
            brands: [{ value: 'Apple', count: 1 }],
            conditions: [{ value: 'New', count: 1 }],
            totalMatches: 1,
          },
        });
      },
    });

    try {
      // 1. Filter-only collection routes (/brands/:brand and /conditions/:condition) omit category=... and render 200
      const brandRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/brands/Apple'
      );
      expect(brandRes.status).toBe(200);
      expect(seenOutboundUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/search?brand=Apple'
      );
      expect(await brandRes.text()).toContain('MacBook Pro 16:Apple:New');

      const condRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/conditions/New'
      );
      expect(condRes.status).toBe(200);
      expect(seenOutboundUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/search?condition=New'
      );

      // 2. :sku SSR route renders 200, queries ?sku=..., and preserves sku in projected state
      const skuRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/sku/MBP16-M4-BLK'
      );
      expect(skuRes.status).toBe(200);
      expect(seenOutboundUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/product?sku=MBP16-M4-BLK'
      );
      expect(await skuRes.text()).toContain('data-sku="MBP16-M4-BLK"');

      const optRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog',
        { method: 'OPTIONS' }
      );
      expect(optRes.status).toBe(204);

      // 3. Framed client route transition / -> /laptops & /sku/MBP16-M4-BLK enriches uncached narrow bootstrap rows via /_baci/catalog?op=route
      const entrySrc = buildClientHydrationEntrySource(
        'src/App.tsx',
        {},
        manifest.routes
      );
      let onMsg: ((ev: unknown) => void) | undefined;
      const snapshots: Record<string, unknown>[] = [];
      const parentWin = {};

      const stub = entrySrc
        .replace(
          "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
          'const CommerceProvider = (p) => p.children; const createCommerceClient = (fn) => fn;'
        )
        .replace(
          "import { createElement, useEffect } from 'react';",
          'const createElement = (t, p, ...c) => (typeof t === "function" ? t({ ...(p || {}), children: c }) : {}); const useEffect = (fn) => { fn(); };'
        )
        .replace(
          "import { hydrateRoot } from 'react-dom/client';",
          'const hydrateRoot = (_el, tree) => ({ render: () => {} });'
        )
        .replace(
          'const mod = await import("./src/App.tsx");',
          'const mod = { default: (p) => { __record(p); return null; } };'
        );

      vm.runInNewContext(stub, {
        URL,
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout,
        fetch: (input: string) => mf.dispatchFetch(input),
        __record: (p: Record<string, unknown>) => snapshots.push(p),
        window: {
          location: { origin: 'null', assign: () => {} },
          parent: parentWin,
          addEventListener: (t: string, cb: (ev: unknown) => void) => {
            if (t === 'message') onMsg = cb;
          },
          removeEventListener: () => {},
        },
        document: {
          baseURI: 'https://ogabassey.mybaci.store/',
          getElementById: (id: string) =>
            id === 'root'
              ? { addEventListener: () => {} }
              : {
                  textContent: JSON.stringify({
                    view: 'home',
                    pathname: '/',
                    workerOrigin: 'https://ogabassey.mybaci.store',
                    merchantSlug: 'ogabassey',
                    title: 'Home',
                    products: [],
                    facets: { brands: [], conditions: [], totalMatches: 0 },
                    productDetail: null,
                    publicDataRevision: '1:1',
                  }),
                },
        },
      });
      await new Promise((r) => setTimeout(r, 20));

      const mockPort: {
        onmessage: ((e: { data: unknown }) => void) | null;
        start: () => void;
        postMessage: () => void;
      } = { onmessage: null, start: () => {}, postMessage: () => {} };

      onMsg?.({
        source: parentWin,
        origin: 'https://usebaci.com',
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-36',
          instanceId: 'inst-36',
          buildDigest: 'c'.repeat(64),
        },
        ports: [mockPort],
      });

      // Route-changing narrow bootstraps (/laptops and /sku/MBP16-M4-BLK)
      const narrowItem = {
        id: 'p_mac',
        slug: 'macbook-pro-16',
        name: 'MacBook Pro 16',
        price: 3_400_000,
        currency: 'NGN',
        available: true,
        image: null,
        variants: [],
      };
      mockPort.onmessage?.({
        data: {
          type: 'bootstrap',
          bootstrap: {
            route: {
              epoch: 2,
              routeId: 'collection',
              params: { category: 'laptops' },
              canonicalPath: '/laptops',
              publicDataRevision: '2:1',
            },
            catalog: { revision: '2:1', products: [narrowItem] },
            capabilities: ['catalog.read', 'navigation'],
          },
        },
      });
      await vi.waitFor(() => {
        expect(snapshots.at(-1)).toMatchObject({
          products: [
            {
              id: 'p_mac',
              price: 3_400_000,
              brand: 'Apple',
              condition: 'New',
              shortSpecs: 'M4 Max · 48GB · 1TB',
            },
          ],
          facets: {
            brands: [{ value: 'Apple', count: 1 }],
            conditions: [{ value: 'New', count: 1 }],
            totalMatches: 1,
          },
        });
      });

      mockPort.onmessage?.({
        data: {
          type: 'bootstrap',
          bootstrap: {
            route: {
              epoch: 3,
              routeId: 'product',
              params: { sku: 'MBP16-M4-BLK' },
              canonicalPath: '/sku/MBP16-M4-BLK',
              publicDataRevision: '2:1',
            },
            catalog: { revision: '2:1', products: [narrowItem] },
            capabilities: ['catalog.read', 'navigation'],
          },
        },
      });
      expect(snapshots.at(-1)).toMatchObject({
        view: 'product',
        productDetail: { id: 'p_mac', slug: 'macbook-pro-16' },
      });
    } finally {
      await mf.dispose();
    }
  });

  it('rejects unverified local memo/forwardRef wrappers while allowing verified React HOC imports', async () => {
    for (const content of [
      `const memo = (_fn: unknown) => ({ bad: true });\nexport default memo(() => <main>Fake</main>);`,
      `const forwardRef = (_fn: unknown) => ({ bad: true });\nexport default forwardRef(() => <main>Fake</main>);`,
      `const React = { memo: (_fn: unknown) => ({ bad: true }) };\nexport default React.memo(() => <main>Fake</main>);`,
    ]) {
      const bad = createOgabasseyStorefrontManifest();
      bad.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(bad)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    const ok = createOgabasseyStorefrontManifest();
    ok.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { memo } from 'react';\nexport default memo(function App() { return <main>Verified Memo</main>; });`,
      },
    ];
    const compiled = await compileStorefrontWorker(ok);
    expect(compiled.workerCode.length).toBeGreaterThan(100);
  });
});

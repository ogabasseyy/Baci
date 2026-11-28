import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 30 compiler & runtime regressions', () => {
  it('rejects JSX prop forwarding and logical-or escaping of destructured open props', async () => {
    const escapes = [
      `function Inner({ fn, ctx }: any) { fn.call(ctx, 'https://evil.example'); return null; }\nfunction Evil({ open: fn, self: ctx }: any) { return <Inner fn={fn} ctx={ctx} />; }\nexport default function X() { return <Evil open={true} self={null} />; }`,
      `function Child({ flag }: { flag: any }) { return flag ? <p>on</p> : null; }\nfunction Evil({ open }: { open: any }) { return <Child flag={open} />; }\nexport default function X() { return <Evil open={true} />; }`,
      `function Evil({ open }: { open: any }) { return (open || (() => {}))('https://evil.example'); }\nexport default function X() { return <Evil open={true} />; }`,
    ];
    for (const content of escapes) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    const safe = createOgabasseyStorefrontManifest();
    safe.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `function Child({ visible }: { visible: boolean }) { return visible ? <p>ok</p> : null; }\nfunction Sheet({ open }: { open: boolean }) { return <Child visible={Boolean(open)} />; }\nexport default function App() { return <Sheet open={true} />; }`,
      },
    ];
    const compiled = await compileStorefrontWorker(safe);
    expect(compiled.workerCode.length).toBeGreaterThan(100);
  });

  it('uses product currency in JSON-LD and tries fallback declared product routes when earlier routes cannot be populated', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/:category/:productSlug/:variantId', view: 'product' },
      { path: '/:category/:productSlug', view: 'product' },
      { path: '/products/:productSlug', view: 'product' },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const usdItem = {
      id: 'p_usd',
      slug: 'macbook-pro-m4',
      name: 'MacBook Pro M4',
      brand: 'Apple',
      currency: 'USD',
      price: 1999,
      priceNgn: 1999,
      inStock: true,
      variants: [],
    };

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        return req.url.includes('/v1/product')
          ? Response.json({
              generation: 1,
              availabilityGeneration: 1,
              product: usdItem,
            })
          : Response.json({
              generation: 1,
              availabilityGeneration: 1,
              categoryExists: true,
              products: [usdItem],
            });
      },
    });

    try {
      const pdpRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/products/macbook-pro-m4'
      );
      expect(pdpRes.status).toBe(200);
      expect(await pdpRes.text()).toContain('"priceCurrency":"USD"');

      const bridgeRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=laptops'
      );
      const body = (await bridgeRes.json()) as {
        value: { products: { canonicalPath?: string; currency: string }[] };
      };
      expect(body.value.products[0]).toMatchObject({
        currency: 'USD',
        canonicalPath: '/products/macbook-pro-m4',
      });
    } finally {
      await mf.dispose();
    }
  });

  it('keeps enriched SSR subset over uncached narrow bootstrap rows, waits for queued commit before render-committed, and ignores _blank anchor clicks', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/smartphones', view: 'collection' },
    ]);

    let messageListener: ((event: unknown) => void) | undefined;
    let finishImport: (() => void) | undefined;
    const effectQueue: (() => void)[] = [];
    const snapshots: Record<string, unknown>[] = [];
    const rootListeners = new Map<
      string,
      (ev: Record<string, unknown>) => void
    >();
    const parentFrame = {};

    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => p.children; const createCommerceClient = (fn) => ({ navigation: { go: (path) => fn("navigation.go", { path }), open: (path) => fn("navigation.open", { path }) }, checkout: { open: () => fn("checkout.open", {}) } });'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = (t, p, ...c) => (typeof t === "function" ? t({ ...(p || {}), children: c }) : {}); const useEffect = (fn) => { __pushEffect(fn); };'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => ({ render: () => {} });'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = await new Promise((r) => { __resolveImport(() => r({ default: (p) => { __recordProps(p); return null; } })); });'
      );

    const initState =
      '{"view":"home","pathname":"/","merchantSlug":"ogabassey","title":"Featured Devices","products":[{"id":"p1","slug":"iphone-15-used","name":"iPhone 15 Pro","categorySlug":"smartphones","brand":"Apple","condition":"Used","priceNgn":950000,"inStock":true,"imageUrl":"https://cdn.usebaci.com/p1.webp","imageAlt":"iPhone 15 Pro","shortSpecs":"256GB","variants":[]}],"facets":{"brands":[{"value":"Apple","count":15}],"conditions":[{"value":"Used","count":15}],"totalMatches":100},"productDetail":null,"publicDataRevision":"1:1"}';

    vm.runInNewContext(stubBody, {
      URL,
      URLSearchParams,
      __pushEffect: (fn: () => void) => effectQueue.push(fn),
      __resolveImport: (fn: () => void) => {
        finishImport = fn;
      },
      __recordProps: (p: Record<string, unknown>) => snapshots.push(p),
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
            : { textContent: initState },
      },
    });

    const sent: Record<string, unknown>[] = [];
    const mockPort: {
      onmessage: ((e: { data: unknown }) => void) | null;
      start: () => void;
      postMessage: (msg: Record<string, unknown>) => void;
    } = {
      onmessage: null,
      start: () => {},
      postMessage: (msg) => sent.push(msg),
    };

    messageListener?.({
      source: parentFrame,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-30',
        instanceId: 'inst-30',
        buildDigest: 'b'.repeat(64),
      },
      ports: [mockPort],
    });

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
          catalog: {
            revision: '2:1',
            products: [
              {
                id: 'p1',
                slug: 'iphone-15-used',
                name: 'iPhone 15 Pro',
                price: 920_000,
                currency: 'NGN',
                available: true,
                image: null,
                variants: [],
              },
              {
                id: 'p_narrow_2',
                slug: 'galaxy-s24',
                name: 'Galaxy S24',
                price: 800_000,
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
    await new Promise((r) => setImmediate(r));

    expect(effectQueue).toHaveLength(1);
    effectQueue.shift()?.();
    expect(sent.some((m) => m.type === 'render-committed')).toBe(false);

    expect(effectQueue).toHaveLength(1);
    effectQueue.shift()?.();
    expect(sent.at(-1)).toEqual({
      type: 'render-committed',
      nonce: 'n-30',
      epoch: 2,
    });

    const latest = snapshots.at(-1) as {
      products: Record<string, unknown>[];
      facets: Record<string, unknown>;
    };
    expect(latest.products).toHaveLength(1);
    expect(latest.products[0]).toMatchObject({
      id: 'p1',
      priceNgn: 920_000,
      brand: 'Apple',
      condition: 'Used',
      shortSpecs: '256GB',
    });
    expect(latest.facets).toMatchObject({ totalMatches: 100 });

    let blankPrevented = false;
    rootListeners.get('click')?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {
        blankPrevented = true;
      },
      target: {
        tagName: 'A',
        getAttribute: (k: string) =>
          k === 'href' ? '/smartphones' : k === 'target' ? '_blank' : null,
      },
    });
    expect(blankPrevented).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      method: 'navigation.open',
      args: { path: '/smartphones' },
    });
    expect(rootListeners.has('auxclick')).toBe(false);
    let submitPrevented = false;
    rootListeners.get('submit')?.({
      type: 'submit',
      defaultPrevented: false,
      preventDefault: () => {
        submitPrevented = true;
      },
      target: {
        getAttribute: (k: string) =>
          k === 'action' ? '/smartphones' : k === 'target' ? '_blank' : null,
        elements: [],
      },
      submitter: {
        hasAttribute: (k: string) => k === 'formtarget',
        getAttribute: (k: string) => (k === 'formtarget' ? '' : null),
      },
    });
    expect(submitPrevented).toBe(true);
  });
});

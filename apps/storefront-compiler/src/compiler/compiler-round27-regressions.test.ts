import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 27 compiler & runtime regressions', () => {
  it('blocks helper-wrapped Window/navigation escapes and arbitrary non-SDK .open() / .location accesses', async () => {
    const escapes = [
      `const getWindow = (e: any) => e.nativeEvent.view;\nexport default function X() { return <button type="button" onClick={(e) => { getWindow(e).open('https://evil.example'); }}>x</button>; }`,
      `function unwrap(x: any) { return x; }\nexport default function X() { return <button type="button" onClick={(e: any) => { unwrap(e.view).navigator.geolocation.getCurrentPosition(() => {}); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(a: any) => { a[0].open('https://evil.example'); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(a: any) => { a[0].location.replace('https://evil.example'); }}>x</button>; }`,
    ];

    for (const content of escapes) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }
  });

  it('intercepts framed native <a> clicks via host MessagePort and keeps recoverable hydration mismatches non-fatal', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/smartphones', view: 'collection' },
      { path: '/search', view: 'search' },
    ]);

    let messageListener: ((event: unknown) => void) | undefined;
    let hydrateOpts: Record<string, unknown> | undefined;
    const rootListeners = new Map<
      string,
      (ev: Record<string, unknown>) => void
    >();
    const parentFrame = {};

    const stubModuleBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = "CP"; const createCommerceClient = (s) => ({ navigation: { go: (path) => s("navigation.go", { path }), open: (path) => s("navigation.open", { path }) }, checkout: { open: () => s("checkout.open", {}) } });'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = () => ({}); const useEffect = () => {};'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = (_el, _tree, opts) => { __captureOpts(opts); };'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );

    const rootEl = {
      addEventListener: (
        type: string,
        cb: (ev: Record<string, unknown>) => void
      ) => {
        rootListeners.set(type, cb);
      },
    };
    const win: Record<string, unknown> = {
      location: { origin: 'null', assign: () => {} },
      parent: parentFrame,
      addEventListener: (type: string, cb: (ev: unknown) => void) => {
        if (type === 'message') messageListener = cb;
      },
      removeEventListener: () => {},
    };

    vm.runInNewContext(stubModuleBody, {
      URL,
      URLSearchParams,
      __captureOpts: (opts: Record<string, unknown>) => {
        hydrateOpts = opts;
      },
      window: win,
      document: {
        getElementById: (id: string) =>
          id === 'root'
            ? rootEl
            : {
                textContent: JSON.stringify({
                  view: 'home',
                  pathname: '/search',
                  merchantSlug: 'ogabassey',
                  publicDataRevision: '1:1',
                }),
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    if (!hydrateOpts || !messageListener) {
      throw new Error('Expected hydrateRoot options and message listener');
    }

    // Recoverable/caught error callbacks must NOT be wired to notifyHostRenderFailed
    expect(hydrateOpts.onRecoverableError).toBeUndefined();
    expect(hydrateOpts.onCaughtError).toBeUndefined();
    expect(typeof hydrateOpts.onUncaughtError).toBe('function');

    const sentOverPort: Record<string, unknown>[] = [];
    const mockPort: {
      onmessage: ((e: { data: unknown }) => void) | null;
      start: () => void;
      postMessage: (msg: Record<string, unknown>) => void;
    } = {
      onmessage: null,
      start: () => {},
      postMessage: (msg) => {
        sentOverPort.push(msg);
        if (msg.protocol === 'baci-commerce/1') {
          const result =
            msg.method === 'navigation.go'
              ? {
                  status: 'ok',
                  value: {
                    epoch: 2,
                    routeId: 'collection',
                    params: {},
                    canonicalPath: '/smartphones',
                    publicDataRevision: '1:1',
                  },
                }
              : { status: 'ok', value: { presented: true } };
          mockPort.onmessage?.({
            data: { type: 'result', requestId: msg.requestId, result },
          });
        }
      },
    };

    messageListener({
      source: parentFrame,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-27',
        instanceId: 'inst-27',
        buildDigest: 'e'.repeat(64),
      },
      ports: [mockPort],
    });

    const clickHandler = rootListeners.get('click');
    expect(clickHandler).toBeDefined();

    // Clicking <a href="/smartphones"> prevents iframe reload and dispatches navigation.go over MessagePort
    let prevented = false;
    clickHandler?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {
        prevented = true;
      },
      target: {
        tagName: 'SPAN',
        parentElement: {
          tagName: 'A',
          getAttribute: (k: string) => (k === 'href' ? '/smartphones' : null),
        },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(prevented).toBe(true);
    expect(sentOverPort.at(-1)).toMatchObject({
      protocol: 'baci-commerce/1',
      method: 'navigation.go',
      args: { path: '/smartphones' },
    });

    // Clicking relative <a href="/checkout"> and <a href="./smartphones"> and submitting GET <form action="/search">
    clickHandler?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {},
      target: {
        tagName: 'A',
        getAttribute: (k: string) => (k === 'href' ? '/checkout' : null),
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sentOverPort.at(-1)).toMatchObject({
      method: 'checkout.open',
      args: {},
    });

    clickHandler?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {},
      target: {
        tagName: 'A',
        getAttribute: (k: string) => (k === 'href' ? './smartphones' : null),
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sentOverPort.at(-1)).toMatchObject({
      method: 'navigation.go',
      args: { path: '/smartphones' },
    });

    const submitHandler = rootListeners.get('submit');
    let formSubmitPrevented = false;
    submitHandler?.({
      type: 'submit',
      defaultPrevented: false,
      preventDefault: () => {
        formSubmitPrevented = true;
      },
      target: {
        getAttribute: () => null,
        elements: [{ name: 'q', value: 'phone' }],
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(formSubmitPrevented).toBe(true);

    // Clicking <a href="https://ogabassey.usebaci.com/checkout"> routes to checkout.open over MessagePort
    let checkoutPrevented = false;
    clickHandler?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {
        checkoutPrevented = true;
      },
      target: {
        tagName: 'A',
        getAttribute: (k: string) =>
          k === 'href' ? 'https://ogabassey.usebaci.com/checkout' : null,
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(checkoutPrevented).toBe(true);
    expect(sentOverPort.at(-1)).toMatchObject({
      protocol: 'baci-commerce/1',
      method: 'checkout.open',
      args: {},
    });
  });

  it('rejects oversized catalog product arrays (> 48 rows) with 502 before rendering', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    const oversizedProducts = Array.from({ length: 49 }, (_, i) => ({
      id: `p_${i}`,
      slug: `phone-${i}`,
      name: `Phone ${i}`,
      priceNgn: 500_000,
      inStock: true,
      variants: [
        { id: `v_${i}`, label: '128GB', priceNgn: 500_000, inStock: true },
      ],
    }));

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService() {
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          categoryExists: true,
          products: oversizedProducts,
          facets: { brands: [], conditions: [], totalMatches: 49 },
        });
      },
    });

    try {
      const ssrRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(ssrRes.status).toBe(502);

      const bridgeRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=smartphones'
      );
      expect(bridgeRes.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });
});

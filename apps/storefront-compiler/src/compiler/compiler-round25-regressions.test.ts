import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round 25 compiler & runtime regressions', () => {
  it('supports previewOrigin in CSP frame-ancestors + host handshake, forwards collection filters, and rejects negative prices', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.previewOrigin = 'https://baci-preview.vercel.app';
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/:category/:brand', view: 'collection' },
      { path: '/shop/:category/:page', view: 'collection' },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const requestedUrls: string[] = [];
    let negativePrice = false;

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        requestedUrls.push(req.url);
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          categoryExists: true,
          products: [
            {
              id: 'p1',
              slug: 'iphone-16',
              name: 'iPhone 16',
              categorySlug: 'smartphones',
              brand: 'Apple',
              condition: 'New',
              priceNgn: negativePrice ? -500 : 900_000,
              inStock: true,
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
      },
    });

    try {
      const brandRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/Apple'
      );
      expect(brandRes.status).toBe(200);
      expect(brandRes.headers.get('content-security-policy')).toContain(
        'frame-ancestors https://usebaci.com https://baci-preview.vercel.app'
      );
      expect(requestedUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/search?category=smartphones&brand=Apple'
      );

      const pageRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/shop/laptops/2'
      );
      expect(pageRes.status).toBe(200);
      expect(requestedUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/search?category=laptops&page=2'
      );

      negativePrice = true;
      const negRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/Apple'
      );
      expect(negRes.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });

  it('dispatches framed cart.* and checkout.* over MessagePort, accepts previewOrigin, and reports react-commit/v1 commit or failure', async () => {
    const previewOrigin = 'https://baci-preview.vercel.app';
    const entrySrc = buildClientHydrationEntrySource(
      'src/App.tsx',
      {},
      [{ path: '/', view: 'home' }],
      previewOrigin
    );

    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown; code?: string }>)
      | undefined;
    let messageListener: ((event: unknown) => void) | undefined;
    let commitEffect: (() => void) | undefined;
    let triggerError: (() => void) | undefined;
    const parentFrame = {};

    const stubModuleBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = "CommerceProvider"; const createCommerceClient = (fn) => { __capture(fn); return fn; };'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = (type, props, ...children) => (typeof type === "function" ? type({ ...(props || {}), children }) : {}); const useEffect = (fn) => { __captureEffect(fn); };'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = (_el, _tree, opts) => { __captureError(opts.onUncaughtError); };'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );

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
      __capture: (fn: typeof capturedTransport) => {
        capturedTransport = fn;
      },
      __captureEffect: (fn: () => void) => {
        commitEffect = fn;
      },
      __captureError: (fn: () => void) => {
        triggerError = fn;
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
                  publicDataRevision: '1:1',
                }),
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    if (
      !capturedTransport ||
      !messageListener ||
      !commitEffect ||
      !triggerError
    ) {
      throw new Error('Expected transport, listener, and commit hooks');
    }

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
          const reply =
            msg.method === 'checkout.prepare'
              ? { status: 'ok', value: { ready: true } }
              : msg.method === 'checkout.open'
                ? { status: 'ok', value: { presented: true } }
                : {
                    status: 'ok',
                    value: {
                      lines: [],
                      total: 1000,
                      currency: 'NGN',
                      version: 2,
                    },
                  };
          mockPort.onmessage?.({
            data: { type: 'result', requestId: msg.requestId, result: reply },
          });
        }
      },
    };

    // Connect from previewOrigin (not production apex)
    messageListener({
      source: parentFrame,
      origin: previewOrigin,
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-25',
        instanceId: 'inst-25',
        buildDigest: 'd'.repeat(64),
      },
      ports: [mockPort],
    });
    expect(sentOverPort[0]).toEqual({
      type: 'ready',
      nonce: 'n-25',
      readiness: 'react-commit/v1',
    });

    // Host sends bootstrap(epoch: 3); render-committed is NOT sent before React effect commits!
    mockPort.onmessage?.({
      data: { type: 'bootstrap', bootstrap: { route: { epoch: 3 } } },
    });
    expect(sentOverPort.some((m) => m.type === 'render-committed')).toBe(false);

    // Once React HydrationCommitGate commits, render-committed is posted with epoch 3
    commitEffect();
    expect(sentOverPort.at(-1)).toEqual({
      type: 'render-committed',
      nonce: 'n-25',
      epoch: 3,
    });

    // Framed cart.add, checkout.prepare, and checkout.open dispatch over MessagePort
    const added = await capturedTransport('cart.add', {
      productId: 'p1',
      quantity: 1,
    });
    expect(added).toMatchObject({ status: 'ok', value: { version: 2 } });
    expect(await capturedTransport('checkout.prepare', {})).toEqual({
      status: 'ok',
      value: { ready: true },
    });
    expect(await capturedTransport('checkout.open', {})).toEqual({
      status: 'ok',
      value: { presented: true },
    });

    // Uncaught error emits render-failed
    triggerError();
    expect(sentOverPort.at(-1)).toEqual({
      type: 'render-failed',
      nonce: 'n-25',
      code: 'HYDRATION_FAILED',
    });
  });
});

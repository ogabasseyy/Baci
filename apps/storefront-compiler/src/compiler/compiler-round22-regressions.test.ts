import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round 22 compiler & runtime regressions', () => {
  it('normalizes price-only upstream records for SSR views without 500s and rejects malformed priceNgn with 502', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    let badPriceNgn = false;

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        const u = new URL(req.url);
        const item = {
          id: 'prod_price_only',
          slug: 'iphone-16-pro',
          name: 'iPhone 16 Pro',
          categorySlug: 'smartphones',
          brand: 'Apple',
          condition: 'New',
          price: 1_450_000,
          ...(badPriceNgn ? { priceNgn: 'invalid' } : {}),
          variants: [
            {
              id: 'var_1',
              label: '256GB / Titanium',
              price: 1_550_000,
              available: true,
            },
          ],
        };
        if (u.pathname === '/v1/product') {
          return Response.json({
            generation: 3,
            availabilityGeneration: 4,
            product: item,
          });
        }
        return Response.json({
          generation: 3,
          availabilityGeneration: 4,
          categoryExists: true,
          products: [item],
          facets: { brands: [], conditions: [], totalMatches: 1 },
        });
      },
    });

    try {
      // Home & PDP SSR succeed with 200 (not 500) when upstream sends `price` + `available` without `priceNgn`
      const homeRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(homeRes.status).toBe(200);
      expect(await homeRes.text()).toContain('1,450,000');

      const pdpRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/iphone-16-pro'
      );
      expect(pdpRes.status).toBe(200);
      const pdpHtml = await pdpRes.text();
      expect(pdpHtml).toContain('1,450,000');
      expect(pdpHtml).toContain('1,550,000');

      // Malformed non-numeric priceNgn alongside finite price fails closed with 502
      badPriceNgn = true;
      const badRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/iphone-16-pro'
      );
      expect(badRes.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });

  it('rejects undeclared routes in navigation.open and routes framed opens over the transferred baci-commerce/1 MessagePort', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/search', view: 'search' },
      { path: '/collections/:handle', view: 'collection' },
    ]);

    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown; code?: string }>)
      | undefined;
    let messageListener: ((event: unknown) => void) | undefined;
    const openedUrls: string[] = [];
    const parentFrame = {};

    const stubModuleBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = "CommerceProvider"; const createCommerceClient = (fn) => { __capture(fn); return fn; };'
      )
      .replace(
        "import { createElement } from 'react';",
        'const createElement = () => ({});'
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
        assign: () => {},
      },
      parent: null as unknown,
      addEventListener: (type: string, cb: (ev: unknown) => void) => {
        if (type === 'message') messageListener = cb;
      },
      removeEventListener: () => {},
      open: (u: string) => {
        openedUrls.push(u);
        return { opener: {} };
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
                  publicDataRevision: '7:2',
                }),
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    if (!capturedTransport || !messageListener) {
      throw new Error('Expected transport and message listener');
    }

    // 1. Top-level navigation.open rejects undeclared destinations with NOT_FOUND
    const undeclaredTop = await capturedTransport('navigation.open', {
      path: '/missing-route',
    });
    expect(undeclaredTop).toMatchObject({ status: 'error', code: 'NOT_FOUND' });
    expect(openedUrls).toHaveLength(0);

    // Declared top-level route succeeds
    const declaredTop = await capturedTransport('navigation.open', {
      path: '/collections/phones',
    });
    expect(declaredTop).toEqual({ status: 'ok', value: { presented: true } });
    expect(openedUrls).toEqual(['/collections/phones']);

    // 2. Framed inside https://usebaci.com without MessagePort fails closed (LAUNCH_EXPIRED)
    win.parent = parentFrame;
    const unconnFramed = await capturedTransport('navigation.open', {
      path: '/collections/phones',
    });
    expect(unconnFramed).toMatchObject({
      status: 'error',
      code: 'LAUNCH_EXPIRED',
    });

    // 3. Handshake baci-experience-connect transfers MessagePort and dispatches BridgeRequest
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
          mockPort.onmessage?.({
            data: {
              type: 'result',
              requestId: msg.requestId,
              result: { status: 'ok', value: { presented: true } },
            },
          });
        }
      },
    };

    const digest64 = 'a'.repeat(64);
    messageListener({
      source: parentFrame,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'nonce-1',
        instanceId: 'inst-1',
        buildDigest: digest64,
      },
      ports: [mockPort],
    });
    expect(sentOverPort[0]).toEqual({ type: 'ready', nonce: 'nonce-1' });

    // Undeclared destination is STILL rejected before sending over MessagePort
    const undeclaredFramed = await capturedTransport('navigation.open', {
      path: '/undeclared',
    });
    expect(undeclaredFramed).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
    });
    expect(sentOverPort).toHaveLength(1);

    // Declared destination sends canonical baci-commerce/1 BridgeRequest and returns acknowledged result
    const ackedFramed = await capturedTransport('navigation.open', {
      path: '/collections/phones',
    });
    expect(ackedFramed).toEqual({ status: 'ok', value: { presented: true } });
    expect(sentOverPort[1]).toMatchObject({
      protocol: 'baci-commerce/1',
      instanceId: 'inst-1',
      buildDigest: digest64,
      routeEpoch: 1,
      capability: 'navigation',
      method: 'navigation.open',
      args: { path: '/collections/phones' },
    });
  });
});

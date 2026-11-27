import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { formatPhase0MarkdownReport } from '../benchmark/cli';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import {
  type Phase0BenchmarkReport,
  runPhase0Benchmarks,
} from '../benchmark/run-phase0-benchmarks';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round 23 compiler & runtime regressions', () => {
  it('strips leaked private catalog fields from SSR state, preserves category handle "all", and queries variants strictly by productId', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    const requestedUrls: string[] = [];

    const backing = generateOgabasseyBackingCatalog(4).map((p, idx) =>
      idx === 0
        ? {
            ...p,
            id: 'prod_first',
            slug: 'prod_second',
            categorySlug: 'all',
            isPublished: true,
          }
        : idx === 1
          ? { ...p, id: 'prod_second', slug: 'flagship-two', isPublished: true }
          : p
    );
    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId: 'merch_ogabassey',
      products: backing,
    });

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      async outboundService(req: { url: string; method: string }) {
        requestedUrls.push(req.url);
        const u = new URL(req.url);
        if (
          u.pathname === '/v1/search' &&
          u.searchParams.get('limit') === '12'
        ) {
          const leakedVar = {
            id: 'var_leak',
            label: '128GB',
            priceNgn: 800_000,
            inStock: true,
            costPriceNgn: 600_000,
          };
          const leakedProd = {
            id: 'prod_leak',
            slug: 'phone-1',
            name: 'Phone One',
            priceNgn: 800_000,
            inStock: true,
            costPriceNgn: 600_000,
            supplierInternalCode: 'SUP-SECRET-999',
            variants: [leakedVar],
          };
          return Response.json({
            generation: 1,
            availabilityGeneration: 1,
            categoryExists: true,
            products: [leakedProd],
            facets: {
              brands: [{ value: 'Apple', count: 1, internalMargin: 0.22 }],
              conditions: [],
              totalMatches: 1,
              secretAuditNote: 'DO-NOT-SERIALIZE',
            },
          });
        }
        const res = await plane.handleOutboundFetch(
          new Request(req.url, { method: req.method }),
          { merchantId: 'merch_ogabassey', merchantSlug: 'ogabassey' },
          'split-availability'
        );
        return new Response(await res.text(), {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
        });
      },
    });

    try {
      // 1. SSR must project ONLY allowlisted public fields into __BACI_STOREFRONT_STATE__
      const homeRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(homeRes.status).toBe(200);
      const homeHtml = await homeRes.text();
      expect(homeHtml).not.toContain('costPriceNgn');
      expect(homeHtml).not.toContain('600000');
      expect(homeHtml).not.toContain('SUP-SECRET-999');
      expect(homeHtml).not.toContain('internalMargin');
      expect(homeHtml).not.toContain('DO-NOT-SERIALIZE');

      // 2. Collection handle "all" queries ?category=all instead of global catalog sentinel
      requestedUrls.length = 0;
      const allColRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=all'
      );
      expect(allColRes.status).toBe(200);
      expect(requestedUrls).toEqual([
        'https://catalog.baci.internal/v1/search?category=all',
      ]);
      const allColBody = (await allColRes.json()) as {
        value: { products: { id: string }[] };
      };
      expect(allColBody.value.products.map((p) => p.id)).toEqual([
        'prod_first',
      ]);

      // 3. Variants lookup queries strictly by productId (does NOT match earlier row whose slug === productId)
      requestedUrls.length = 0;
      const varRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=variants&productId=prod_second'
      );
      expect(varRes.status).toBe(200);
      expect(requestedUrls).toEqual([
        'https://catalog.baci.internal/v1/product?productId=prod_second',
      ]);
      const varBody = (await varRes.json()) as {
        value: { id: string }[];
      };
      expect(varBody.value[0]?.id).toBe(backing[1]?.variants[0]?.id);
    } finally {
      await mf.dispose();
    }
  });

  it('routes framed navigation.go over the baci-commerce/1 MessagePort without reloading the iframe', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/search', view: 'search' },
    ]);

    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown; code?: string }>)
      | undefined;
    let messageListener: ((event: unknown) => void) | undefined;
    const assignedUrls: string[] = [];
    const parentFrame = {};

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
      window: win,
      document: {
        getElementById: (id: string) =>
          id === 'root'
            ? {}
            : {
                textContent: JSON.stringify({
                  view: 'home',
                  merchantSlug: 'ogabassey',
                  publicDataRevision: '2:1',
                }),
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    if (!capturedTransport || !messageListener)
      throw new Error('Expected transport and listener');

    expect(
      await capturedTransport('navigation.go', { path: '/search' })
    ).toMatchObject({
      status: 'error',
      code: 'LAUNCH_EXPIRED',
    });
    expect(assignedUrls).toHaveLength(0);

    const sentOverPort: Record<string, unknown>[] = [];
    const expectedRoute = {
      epoch: 2,
      routeId: 'search',
      params: {},
      canonicalPath: '/search?q=iphone#top',
      publicDataRevision: '9:3',
    };
    const mockPort: {
      onmessage: ((e: { data: unknown }) => void) | null;
      start: () => void;
      postMessage: (msg: Record<string, unknown>) => void;
    } = {
      onmessage: null,
      start: () => {},
      postMessage: (msg) => {
        sentOverPort.push(msg);
        if (
          msg.protocol === 'baci-commerce/1' &&
          msg.method === 'navigation.go'
        ) {
          mockPort.onmessage?.({
            data: {
              type: 'result',
              requestId: msg.requestId,
              result: { status: 'ok', value: expectedRoute },
            },
          });
        }
      },
    };

    messageListener({
      source: parentFrame,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-23',
        instanceId: 'inst-23',
        buildDigest: 'b'.repeat(64),
      },
      ports: [mockPort],
    });

    expect(
      await capturedTransport('navigation.go', { path: '/search?q=iphone#top' })
    ).toEqual({ status: 'ok', value: expectedRoute });
    expect(assignedUrls).toHaveLength(0);
    expect(sentOverPort[1]).toMatchObject({
      protocol: 'baci-commerce/1',
      capability: 'navigation',
      method: 'navigation.go',
      args: { path: '/search?q=iphone#top' },
    });
  });

  it('records observedStatus on benchmark route rows and renders unexpected statuses visibly in Markdown', async () => {
    const report = await runPhase0Benchmarks({
      warmCompileIterations: 1,
      coldCliProcessIterations: 1,
      warmSsrIterations: 1,
      productCount: 40,
    });
    for (const row of report.workerdSsr.routes) {
      expect(row.observedStatus).toBe(row.expectedStatus);
    }
    const syntheticRegression: Phase0BenchmarkReport = {
      ...report,
      workerdSsr: {
        ...report.workerdSsr,
        true404Verified: false,
        routes: report.workerdSsr.routes.map((r, i) =>
          i === 0 ? { ...r, observedStatus: 500 } : r
        ),
      },
    };
    const md = formatPhase0MarkdownReport(syntheticRegression);
    expect(md).toContain('`500` (expected `200`)');
  });
});

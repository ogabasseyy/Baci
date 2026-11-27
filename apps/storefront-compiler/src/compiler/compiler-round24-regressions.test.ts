import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import {
  VICTIM_SENTINEL_PRODUCT_NAME,
  verifySpoofedTenantBlocked,
} from '../benchmark/spoof-probe';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 24 compiler, Dockerfile, host port, and spoof-probe regressions', () => {
  it('copies workspace patches/ into Dockerfile builder stage before frozen pnpm install', () => {
    const dockerfilePath = path.resolve(
      import.meta.dirname,
      '../../Dockerfile'
    );
    const content = fs.readFileSync(dockerfilePath, 'utf8');
    const copyPatchesIdx = content.indexOf('COPY patches ./patches');
    const pnpmInstallIdx = content.indexOf(
      'RUN pnpm install --frozen-lockfile'
    );
    expect(copyPatchesIdx).toBeGreaterThan(0);
    expect(pnpmInstallIdx).toBeGreaterThan(copyPatchesIdx);
  });

  it('routes framed catalog.collection, catalog.product, and catalog.variants over the transferred baci-commerce/1 MessagePort', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
    ]);

    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown; code?: string }>)
      | undefined;
    let messageListener: ((event: unknown) => void) | undefined;
    let fetchCalled = false;
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
      location: { origin: 'null', assign: () => {} },
      parent: parentFrame,
      addEventListener: (type: string, cb: (ev: unknown) => void) => {
        if (type === 'message') messageListener = cb;
      },
      removeEventListener: () => {},
    };

    vm.runInNewContext(stubModuleBody, {
      URL,
      fetch: async () => {
        fetchCalled = true;
        throw new Error(
          'Cross-origin fetch should not be called in sandboxed iframe'
        );
      },
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
                  publicDataRevision: '1:1',
                }),
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    if (!capturedTransport || !messageListener)
      throw new Error('Expected transport and listener');

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
          const val =
            msg.method === 'catalog.collection'
              ? {
                  products: [
                    {
                      id: 'p1',
                      slug: 's1',
                      name: 'N',
                      price: 10,
                      currency: 'NGN',
                      image: null,
                      variants: [],
                    },
                  ],
                  revision: '8:4',
                }
              : msg.method === 'catalog.product'
                ? {
                    id: 'p1',
                    slug: 's1',
                    name: 'N',
                    price: 10,
                    currency: 'NGN',
                    image: null,
                    variants: [],
                  }
                : [{ id: 'v1', label: 'Blue', available: true }];
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

    messageListener({
      source: parentFrame,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-24',
        instanceId: 'inst-24',
        buildDigest: 'c'.repeat(64),
      },
      ports: [mockPort],
    });

    const col = await capturedTransport('catalog.collection', {
      handle: 'smartphones',
    });
    expect(col).toMatchObject({ status: 'ok', value: { revision: '8:4' } });

    const prod = await capturedTransport('catalog.product', { handle: 's1' });
    expect(prod).toMatchObject({ status: 'ok', value: { id: 'p1' } });

    const vars = await capturedTransport('catalog.variants', {
      productId: 'p1',
    });
    expect(vars).toMatchObject({ status: 'ok', value: [{ id: 'v1' }] });
    expect(fetchCalled).toBe(false);
    expect(sentOverPort[1]).toMatchObject({
      capability: 'catalog.read',
      method: 'catalog.collection',
      args: { handle: 'smartphones' },
    });
    expect(sentOverPort[2]).toMatchObject({
      capability: 'catalog.read',
      method: 'catalog.product',
      args: { handle: 's1' },
    });
    expect(sentOverPort[3]).toMatchObject({
      capability: 'catalog.read',
      method: 'catalog.variants',
      args: { productId: 'p1' },
    });
  });

  it('blocks DOM traversal aliases, sensitive-root taint aliases, and non-literal or aliased require()', async () => {
    const badSnippets = [
      `const d = document.documentElement.parentNode; (d as any).location = 'https://evil.example';`,
      `const d = document.body; (d as any).location = 'https://evil.example';`,
      `const w = window; w.location.replace('https://evil.example');`,
      `export default function X() { const m = 'react'; const r = require(m); return <p>{String(Boolean(r))}</p>; }`,
      `export default function X() { const r = require; return <p>{String(Boolean(r))}</p>; }`,
    ];

    for (const src of badSnippets) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [
        {
          path: 'src/StorefrontApp.tsx',
          content: src.includes('export default')
            ? src
            : `import { useEffect } from 'react'; export default function X() { useEffect(() => { ${src} }, []); return <p>x</p>; }`,
        },
      ];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }
  });

  it('provisions a populated victim tenant with sentinel catalog data and verifies spoofed requests cannot read it', async () => {
    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId: 'merch_trusted',
      products: [
        {
          id: 'trusted_1',
          slug: 'iphone-trusted',
          name: 'Trusted iPhone 16',
          categorySlug: 'smartphones',
          categoryName: 'Smartphones',
          brand: 'Apple',
          condition: 'New',
          priceNgn: 900_000,
          costPriceNgn: 700_000,
          supplierInternalCode: 'SUP-1',
          isPublished: true,
          imageUrl: 'https://cdn.usebaci.com/t.webp',
          imageAlt: 'Trusted',
          shortSpecs: 'iphone',
          variants: [
            {
              id: 'tv1',
              sku: 'T1',
              label: '128GB',
              storage: '128GB',
              color: 'Black',
              priceNgn: 900_000,
              costPriceNgn: 700_000,
              stockQty: 3,
            },
          ],
        },
      ],
    });
    const fakeIsolate = {
      dispatchFetch: async () =>
        new Response('<html>Apple Trusted iPhone 16</html>', { status: 200 }),
    };
    const ok = await verifySpoofedTenantBlocked({
      spoofIsolate: fakeIsolate as never,
      outboundPlane: plane,
      trustedParams: { merchantId: 'merch_trusted', merchantSlug: 'ogabassey' },
    });
    expect(ok).toBe(true);

    // If an isolate leaked the victim sentinel name, verifySpoofedTenantBlocked returns false
    const leakyIsolate = {
      dispatchFetch: async () =>
        new Response(`<html>Apple ${VICTIM_SENTINEL_PRODUCT_NAME}</html>`, {
          status: 200,
        }),
    };
    const leaked = await verifySpoofedTenantBlocked({
      spoofIsolate: leakyIsolate as never,
      outboundPlane: plane,
      trustedParams: { merchantId: 'merch_trusted', merchantSlug: 'ogabassey' },
    });
    expect(leaked).toBe(false);
  });
});

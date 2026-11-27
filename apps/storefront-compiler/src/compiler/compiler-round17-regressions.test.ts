import vm from 'node:vm';
import { Miniflare, type Request as MiniflareRequest } from 'miniflare';
import { describe, expect, it } from 'vitest';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round-17 Codex class-heritage scan, reserved /_baci route, Tailwind candidate URL scope, and catalog image preservation', () => {
  it('scans runtime class-heritage extends expressions while ignoring type-only implements/interface heritage', async () => {
    const evilManifest = createOgabasseyStorefrontManifest();
    evilManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          class Gate extends (typeof window === 'undefined' ? class {} : (window.location.replace('https://evil.example'), class {})) {}
          export default function App() {
            void Gate;
            return <main>Gate</main>;
          }
        `,
      },
    ];
    await expect(compileStorefrontWorker(evilManifest)).rejects.toMatchObject({
      code: 'SOURCE_SAFETY_VIOLATION',
    });

    const benignManifest = createOgabasseyStorefrontManifest();
    benignManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          interface Navigation { location: string }
          interface SubNav extends Navigation {}
          class BaseWidget<T> { value?: T }
          class ChildWidget extends BaseWidget<Navigation> {}
          export default function App() {
            const w = new ChildWidget();
            void w;
            return <main>Safe</main>;
          }
        `,
      },
    ];
    await expect(
      compileStorefrontWorker(benignManifest)
    ).resolves.toBeDefined();
  });

  it('rejects manifests declaring reserved /_baci or /_baci/catalog routes', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes.push({ path: '/_baci/catalog', view: 'editorial' });
    await expect(compileStorefrontWorker(manifest)).rejects.toMatchObject({
      code: 'INVALID_MANIFEST',
    });
  });

  it('allows harmless product copy containing url(...) while still blocking undeclared Tailwind arbitrary url() classes', async () => {
    const benign = createOgabasseyStorefrontManifest();
    benign.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          // Documentation note: Read url(https://docs.example/help)
          export default function App() {
            const copy = 'Read url(https://docs.example/help) before pairing';
            return <main className="p-4 bg-[url('/assets/hero-banner')]">{copy}</main>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(benign);
    expect(compiled.cssCode).toContain('/assets/hero-banner');

    const malicious = createOgabasseyStorefrontManifest();
    malicious.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          export default function App() {
            return <div className="bg-[url('https://cdn.usebaci.com/undeclared.png')]" />;
          }
        `,
      },
    ];
    await expect(compileStorefrontWorker(malicious)).rejects.toMatchObject({
      code: 'GRAPH_ESCAPE_BLOCKED',
    });
  });

  it('preserves PublicProduct.image asset references and populates runtime asset URL map for catalog.collection and catalog.product', async () => {
    const backing = generateOgabasseyBackingCatalog(4);
    const target = backing.find((p) => p.isPublished);
    if (!target) throw new Error('Expected published fixture');

    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId: 'merch_ogabassey',
      products: backing,
    });
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'index.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: async (req: MiniflareRequest) => {
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
      const entrySrc = buildClientHydrationEntrySource(
        'src/StorefrontApp.tsx',
        {}
      );
      let transport:
        | ((
            method: string,
            args: Record<string, unknown>
          ) => Promise<{ status: string; value?: unknown }>)
        | undefined;
      let providerAssets: Record<string, string> = {};

      const stubBody = entrySrc
        .replace(
          "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
          'const CommerceProvider = "CommerceProvider"; const createCommerceClient = (fn) => { __capture(fn); return fn; };'
        )
        .replace(
          "import { createElement, useEffect } from 'react';",
          'const createElement = (type, props) => { if (type === "CommerceProvider" && props?.assets) __captureAssets(props.assets); return {}; };'
        )
        .replace(
          "import { hydrateRoot } from 'react-dom/client';",
          'const hydrateRoot = () => {};'
        )
        .replace(
          'await import("./src/StorefrontApp.tsx")',
          'await Promise.resolve({ default: () => null })'
        );

      const winMock = {
        location: {
          origin: 'https://ogabassey.mybaci.store',
          assign: () => {},
        },
        parent: null as unknown,
        open: () => null,
      };
      winMock.parent = winMock;

      vm.runInNewContext(stubBody, {
        URL,
        fetch: (input: string, init?: RequestInit) =>
          mf.dispatchFetch(input, init as never),
        __capture: (fn: typeof transport) => {
          transport = fn;
        },
        __captureAssets: (a: Record<string, string>) => {
          providerAssets = a;
        },
        window: winMock,
        document: {
          getElementById: (id: string) =>
            id === 'root'
              ? {}
              : {
                  textContent: JSON.stringify({
                    view: 'home',
                    merchantSlug: 'ogabassey',
                  }),
                },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      if (!transport) throw new Error('Expected hydration transport');

      const prodRes = await transport('catalog.product', {
        handle: target.slug,
      });
      expect(prodRes.status).toBe('ok');
      const prodVal = prodRes.value as {
        image: { assetId: string; alt: string } | null;
      };
      expect(prodVal.image).toEqual({
        assetId: `catalog-product-${target.id}`,
        alt: target.imageAlt,
      });
      expect(providerAssets[`catalog-product-${target.id}`]).toBe(
        target.imageUrl
      );
    } finally {
      await mf.dispose();
    }
  });
});

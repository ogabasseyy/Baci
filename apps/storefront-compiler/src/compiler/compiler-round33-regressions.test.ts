import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 33 canonical JSON-LD URL, connectExperience ban, and query/hash anchor guards', () => {
  it('rejects authored connectExperience imports/calls and query/hash-bearing route anchors while allowing pure #hash anchors', async () => {
    const invalid = [
      `import { connectExperience } from '@baci/experience-sdk';\nexport default function X() { void connectExperience; return <p>x</p>; }`,
      `import * as sdk from '@baci/experience-sdk';\nexport default function X() { return <button type="button" onClick={() => { sdk.connectExperience('https://usebaci.com'); }}>x</button>; }`,
      `export default function X() { return <a href="/products/phone?variant=blue">Buy</a>; }`,
      `export default function X() { return <a href="/products/phone#specs">Specs</a>; }`,
    ];

    for (const content of invalid) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    // Pure fragment #specs and canonical hostOrigin JSON-LD URL work end-to-end
    const manifest = createOgabasseyStorefrontManifest();
    manifest.hostOrigin = 'https://shop.ogabassey.com';
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App({ slug }: { slug?: string }) { const dyn = slug ?? 'phone?variant=blue'; return <main><a href="#specs">Specs</a><a id="dyn-q" href={\`/smartphones/\${dyn}\`}>Item</a></main>; }`,
      },
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
          categoryExists: true,
          products: [],
          facets: { brands: [], conditions: [], totalMatches: 0 },
        });
      },
    });

    try {
      const homeRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(homeRes.status).toBe(200);
      const homeHtml = await homeRes.text();
      expect(homeHtml).toContain('"url":"https://shop.ogabassey.com/"');
      expect(homeHtml).toContain('href="#specs"');
      // Dynamic runtime query string in href is neutralized to "#" by jsx-runtime-guard
      expect(homeHtml).toContain('id="dyn-q" href="#"');

      const colRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones'
      );
      expect(await colRes.text()).toContain(
        '"url":"https://shop.ogabassey.com/smartphones"'
      );
    } finally {
      await mf.dispose();
    }
  });

  it('calls preventDefault() and routes query-bearing DOM anchors over host navigation.go without reloading the iframe', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/smartphones', view: 'collection' },
    ]);

    let messageListener: ((event: unknown) => void) | undefined;
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
        'const createElement = () => ({}); const useEffect = () => {};'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => ({ render: () => {} });'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );

    vm.runInNewContext(stubBody, {
      URL,
      URLSearchParams,
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
            : {
                textContent:
                  '{"view":"home","pathname":"/","merchantSlug":"ogabassey","publicDataRevision":"1:1"}',
              },
      },
    });
    await new Promise((r) => setImmediate(r));

    const sent: Record<string, unknown>[] = [];
    const mockPort = {
      onmessage: null,
      start: () => {},
      postMessage: (msg: Record<string, unknown>) => sent.push(msg),
    };
    messageListener?.({
      source: parentFrame,
      origin: 'https://ogabassey.usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-33',
        instanceId: 'inst-33',
        buildDigest: 'e'.repeat(64),
      },
      ports: [mockPort],
    });

    let queryPrevented = false;
    rootListeners.get('click')?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {
        queryPrevented = true;
      },
      target: {
        tagName: 'A',
        getAttribute: (k: string) =>
          k === 'href' ? '/smartphones?variant=blue' : null,
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(queryPrevented).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      method: 'navigation.go',
      args: { path: '/smartphones' },
    });
  });
});

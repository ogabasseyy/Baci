import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { compileStorefrontWorker } from './compile-storefront';
import { buildContentSecurityPolicyHeader } from './csp-header';

describe('Round 32 canonical hostOrigin framing & handshake regressions', () => {
  it('includes default tenant subdomain and custom hostOrigin in CSP frame-ancestors and sourceDigest', async () => {
    const composableRoutes = [
      { path: '/', view: 'home' as const },
      { path: '/collections/[handle]', view: 'collection' as const },
      { path: '/products/[handle]', view: 'product' as const },
    ];
    const baseManifest = createOgabasseyStorefrontManifest();
    baseManifest.mode = 'composable';
    baseManifest.routes = composableRoutes;
    const defaultCsp = buildContentSecurityPolicyHeader(baseManifest);
    expect(defaultCsp).toContain(
      'frame-ancestors https://usebaci.com https://ogabassey.usebaci.com'
    );

    const customManifest = createOgabasseyStorefrontManifest();
    customManifest.mode = 'composable';
    customManifest.routes = composableRoutes;
    customManifest.hostOrigin = 'https://shop.ogabassey.com';
    customManifest.previewOrigin = 'https://baci-preview.vercel.app';
    customManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App() { return <main><a href="https://shop.ogabassey.com/cart">Cart</a></main>; }`,
      },
    ];
    const compiledDefault = await compileStorefrontWorker(baseManifest);
    const compiledCustom = await compileStorefrontWorker(customManifest);
    expect(compiledCustom.sourceDigest).not.toBe(compiledDefault.sourceDigest);

    const mf = new Miniflare({
      modules: true,
      script: compiledCustom.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService() {
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          products: [],
          facets: { brands: [], conditions: [], totalMatches: 0 },
        });
      },
    });

    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-security-policy')).toContain(
        'frame-ancestors https://usebaci.com https://baci-preview.vercel.app https://ogabassey.usebaci.com https://shop.ogabassey.com'
      );
      expect(await res.text()).toContain(
        'href="https://shop.ogabassey.com/cart"'
      );
    } finally {
      await mf.dispose();
    }
  });

  it('accepts baci-experience-connect handshakes from both tenant subdomain and custom hostOrigin while rejecting untrusted origins', async () => {
    for (const { hostOrigin, connectOrigin } of [
      {
        hostOrigin: undefined,
        connectOrigin: 'https://ogabassey.usebaci.com',
      },
      {
        hostOrigin: 'https://shop.ogabassey.com',
        connectOrigin: 'https://shop.ogabassey.com',
      },
    ]) {
      const entrySrc = buildClientHydrationEntrySource(
        'src/App.tsx',
        {},
        [{ path: '/', view: 'home' }],
        undefined,
        hostOrigin
      );

      let messageListener: ((event: unknown) => void) | undefined;
      const parentFrame = {};

      const stubBody = entrySrc
        .replace(
          "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
          'const CommerceProvider = (p) => p.children; const createCommerceClient = (fn) => fn;'
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
              ? { addEventListener: () => {} }
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

      // Evil origin is ignored
      messageListener?.({
        source: parentFrame,
        origin: 'https://evil.example',
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-evil',
          instanceId: 'inst-evil',
          buildDigest: 'd'.repeat(64),
        },
        ports: [mockPort],
      });
      expect(sent).toHaveLength(0);

      // Canonical storefront origin succeeds
      messageListener?.({
        source: parentFrame,
        origin: connectOrigin,
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-32',
          instanceId: 'inst-32',
          buildDigest: 'd'.repeat(64),
        },
        ports: [mockPort],
      });
      expect(sent[0]).toEqual({
        type: 'ready',
        nonce: 'n-32',
        readiness: 'react-commit/v1',
      });
    }
  });
});

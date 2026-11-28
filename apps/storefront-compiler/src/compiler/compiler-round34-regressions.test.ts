import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { deriveCompileSigkillTimeoutMs } from '../sandbox/container-profiles';
import { parseWorkerStorefrontManifest } from '../schemas/worker-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';
import { buildContentSecurityPolicyHeader } from './csp-header';

describe('Round 34 origin, framed-anchor, iframe, timeout, and asset-namespace regressions', () => {
  it('requires bare HTTPS storefront hostOrigin while preserving localhost HTTP previewOrigin', () => {
    const valid = createOgabasseyStorefrontManifest();
    valid.hostOrigin = 'https://shop.ogabassey.com';
    valid.previewOrigin = 'http://localhost:3000';
    expect(() => parseWorkerStorefrontManifest(valid)).not.toThrow();

    for (const badHostOrigin of [
      'http://localhost:3000',
      'http://127.0.0.1:8787',
      'https://localhost:3000',
      'https://shop.ogabassey.com:8443',
      'https://usebaci.com',
      'https://other-tenant.usebaci.com',
    ]) {
      const invalid = createOgabasseyStorefrontManifest();
      invalid.hostOrigin = badHostOrigin;
      expect(() => parseWorkerStorefrontManifest(invalid)).toThrow();
    }
  });

  it('does not rewrite apex https://usebaci.com anchors into tenant-relative navigation.go calls', async () => {
    const entrySrc = buildClientHydrationEntrySource(
      'src/App.tsx',
      {},
      [
        { path: '/', view: 'home' },
        { path: '/smartphones', view: 'collection' },
      ],
      undefined,
      'https://shop.ogabassey.com'
    );

    const navCalls: string[] = [];
    const rootListeners = new Map<
      string,
      (ev: Record<string, unknown>) => void
    >();
    const parentFrame = {};

    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => p.children; const createCommerceClient = () => ({ navigation: { go: (path) => { __recordNav(path); return Promise.resolve({ status: "ok" }); }, open: () => Promise.resolve({ status: "ok" }) }, checkout: { open: () => Promise.resolve({ status: "ok" }) } });'
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
      __recordNav: (p: string) => navCalls.push(p),
      window: {
        location: { origin: 'null', assign: () => {} },
        parent: parentFrame,
        addEventListener: () => {},
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

    const clickHandler = rootListeners.get('click');
    expect(clickHandler).toBeDefined();

    // Apex https://usebaci.com/privacy must NOT be stripped to tenant /privacy
    let apexPrevented = false;
    clickHandler?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {
        apexPrevented = true;
      },
      target: {
        tagName: 'A',
        hasAttribute: (k: string) => k === 'href',
        getAttribute: (k: string) =>
          k === 'href' ? 'https://usebaci.com/privacy' : null,
      },
    });
    expect(apexPrevented).toBe(false);
    expect(navCalls).toHaveLength(0);

    // Merchant canonical origin https://shop.ogabassey.com/smartphones IS routed via navigation.go
    let storePrevented = false;
    clickHandler?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {
        storePrevented = true;
      },
      target: {
        tagName: 'A',
        hasAttribute: (k: string) => k === 'href',
        getAttribute: (k: string) =>
          k === 'href' ? 'https://shop.ogabassey.com/smartphones' : null,
      },
    });
    expect(storePrevented).toBe(true);
    expect(navCalls).toEqual(['/smartphones']);
  });

  it('blocks nested <iframe> / <motion.iframe> elements at compile time and emits frame-src none in CSP', async () => {
    const baseManifest = createOgabasseyStorefrontManifest();
    expect(buildContentSecurityPolicyHeader(baseManifest)).toContain(
      "frame-src 'none'"
    );

    for (const content of [
      `export default function App() { return <main><iframe src="/" title="loop" /></main>; }`,
      `import { motion } from 'framer-motion';\nexport default function App() { return <main><motion.iframe src="/" /></main>; }`,
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.packages = [{ name: 'framer-motion', versionRef: 'platform-pinned' }];
      m.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(m)).rejects.toThrow(
        StorefrontCompilerError
      );
    }
  });

  it('preserves the documented max(5 * p95, 5000ms) SIGKILL timeout without clamping slow p95s to 30s', () => {
    expect(deriveCompileSigkillTimeoutMs(420)).toBe(5000);
    expect(deriveCompileSigkillTimeoutMs(8000)).toBe(40000);
  });

  it('reserves catalog-product-* asset IDs and prevents catalog rows from overwriting declared manifest assets', async () => {
    const reservedManifest = createOgabasseyStorefrontManifest();
    reservedManifest.assets = [
      { assetId: 'catalog-product-logo', alt: 'Colliding asset' },
    ];
    expect(() => parseWorkerStorefrontManifest(reservedManifest)).toThrow(
      /catalog-product-/
    );

    const manifest = createOgabasseyStorefrontManifest();
    manifest.assets = [{ assetId: 'hero-banner', alt: 'Declared Hero Banner' }];
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { useAssetUrl } from '@baci/experience-sdk';\nexport default function App(props: { products?: Array<{ image?: { assetId?: string } }> }) { const hero = useAssetUrl('hero-banner'); const prodImg = useAssetUrl(props.products?.[0]?.image?.assetId ?? ''); return <main data-hero={hero} data-prod={prodImg}>Store</main>; }`,
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
          products: [
            {
              id: 'p_1',
              slug: 'flagship',
              name: 'Flagship',
              priceNgn: 100_000,
              inStock: true,
              image: { assetId: 'hero-banner', alt: 'Hijack attempt' },
              imageUrl: 'https://cdn.usebaci.com/hijack.webp',
              variants: [
                { id: 'v_1', label: 'Base', priceNgn: 100_000, inStock: true },
              ],
            },
          ],
          facets: { brands: [], conditions: [], totalMatches: 1 },
        });
      },
    });

    try {
      const ssrRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(ssrRes.status).toBe(200);
      const ssrHtml = await ssrRes.text();
      expect(ssrHtml).toContain('data-hero="/assets/hero-banner"');
      expect(ssrHtml).toContain(
        'data-prod="https://cdn.usebaci.com/hijack.webp"'
      );

      const colRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=smartphones'
      );
      expect(colRes.status).toBe(200);
      const colJson = (await colRes.json()) as {
        assets: Record<string, string>;
        value: { products: Array<{ image: { assetId: string } }> };
      };
      expect(colJson.assets['hero-banner']).toBeUndefined();
      expect(colJson.assets['catalog-product-p_1']).toBe(
        'https://cdn.usebaci.com/hijack.webp'
      );
      expect(colJson.value.products[0]?.image.assetId).toBe(
        'catalog-product-p_1'
      );
    } finally {
      await mf.dispose();
    }
  });
});

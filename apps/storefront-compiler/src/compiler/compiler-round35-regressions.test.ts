import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';
import { buildFrameErrorAsset } from './frame-error-script-snippet';

describe('Round 35 interpolated anchors, React class verification, and framed 5xx handshake regressions', () => {
  it('neutralizes interpolated ///evil.example and /foo//bar hrefs at runtime and prevents untrusted framed _self navigation', async () => {
    const partialConstManifest = createOgabasseyStorefrontManifest();
    partialConstManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App({ id }: { id?: string }) { const bad = '//evil.example'; return <a href={\`/\${bad}/\${id ?? 'x'}\`}>Bad</a>; }`,
      },
    ];
    await expect(compileStorefrontWorker(partialConstManifest)).rejects.toThrow(
      StorefrontCompilerError
    );

    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App(props: { products: Array<{ slug: string }> }) {
          const s0 = props.products[0]?.slug ?? 'safe';
          const s1 = props.products[1]?.slug ?? 'safe';
          return <main><a id="triple" href={\`/\${s0}\`}>One</a><a id="double-mid" href={\`/smartphones/\${s1}\`}>Two</a></main>;
        }`,
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
          products: [
            {
              id: '1',
              slug: '//evil.example',
              name: 'One',
              priceNgn: 1000,
              inStock: true,
              variants: [
                { id: 'v1', label: 'Base', priceNgn: 1000, inStock: true },
              ],
            },
            {
              id: '2',
              slug: '/sub',
              name: 'Two',
              priceNgn: 1000,
              inStock: true,
              variants: [
                { id: 'v2', label: 'Base', priceNgn: 1000, inStock: true },
              ],
            },
          ],
          facets: { brands: [], conditions: [], totalMatches: 2 },
        });
      },
    });
    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('id="triple" href="#"');
      expect(html).toContain('id="double-mid" href="#"');
      expect(html).not.toContain('///evil.example');
    } finally {
      await mf.dispose();
    }

    // Framed click interceptor also blocks untrusted _self anchors from navigating the iframe
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
    ]);
    const rootListeners = new Map<
      string,
      (ev: Record<string, unknown>) => void
    >();
    const stub = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => p.children; const createCommerceClient = () => ({ navigation: { go: () => Promise.resolve({ status: "ok" }), open: () => Promise.resolve({ status: "ok" }) }, checkout: { open: () => Promise.resolve({ status: "ok" }) } });'
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
    vm.runInNewContext(stub, {
      URL,
      URLSearchParams,
      window: {
        location: { origin: 'null', assign: () => {} },
        parent: {},
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
    let evilPrevented = false;
    rootListeners.get('click')?.({
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault: () => {
        evilPrevented = true;
      },
      target: {
        tagName: 'A',
        hasAttribute: (k: string) => k === 'href',
        getAttribute: (k: string) => (k === 'href' ? '///evil.example' : null),
      },
    });
    expect(evilPrevented).toBe(true);
  });

  it('rejects plain non-React ES class exports and JSX tags while allowing verified React.Component subclasses', async () => {
    for (const content of [
      `export default class Storefront {}`,
      `class FakeBase {}\nexport default class Storefront extends FakeBase { render() { return <main>No</main>; } }`,
      `import { Component } from 'react';\nexport default class Storefront extends Component {}`,
      `class Widget {}\nexport default function App() { return <main><Widget /></main>; }`,
      `import { Component, memo } from 'react';\nclass Base extends Component { render() { return null; } }\nconst Wrapped = memo(Base);\nexport default class Bad extends (Wrapped as any) {}`,
      `const App = Later;\nconst Later = () => <main>TDZ</main>;\nexport default App;`,
    ]) {
      const bad = createOgabasseyStorefrontManifest();
      bad.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(bad)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    const valid = createOgabasseyStorefrontManifest();
    valid.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { Component, PureComponent } from 'react';
const BaseBanner = class extends Component { render() { return <span>Verified</span>; } };
const Tree = class Tree extends Component<{ depth: number }> { render() { return this.props.depth > 0 ? <Tree depth={0} /> : <em>Leaf</em>; } };
class ChildBanner extends BaseBanner {}
export default class Storefront extends PureComponent<{ title: string }> { render() { return <main><h1>{this.props.title}</h1><ChildBanner /><Tree depth={1} /></main>; } }`,
      },
    ];
    const compiled = await compileStorefrontWorker(valid);
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
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
      const html = await res.text();
      expect(html).toContain('<h1>Featured Devices</h1>');
      expect(html).toContain('<span>Verified</span>');
    } finally {
      await mf.dispose();
    }
  });

  it('signals framed server-render 502/500 failures immediately via frame-error.js without loading merchant client bundle', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.mode = 'composable';
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/collections/[handle]', view: 'collection' },
      { path: '/products/[handle]', view: 'product' },
    ];
    manifest.hostOrigin = 'https://shop.ogabassey.com';
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService() {
        return new Response('Upstream error', { status: 503 });
      },
    });

    try {
      const res502 = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(res502.status).toBe(502);
      const html502 = await res502.text();
      expect(html502).not.toContain('__BACI_STOREFRONT_STATE__');
      expect(html502).not.toContain(compiled.assets.clientAssetPath);
      const frameErrorPath = buildFrameErrorAsset(manifest).path;
      expect(html502).toContain(
        `<script type="module" src="${frameErrorPath}"></script>`
      );

      const scriptRes = await mf.dispatchFetch(
        `https://ogabassey.mybaci.store${frameErrorPath}`
      );
      expect(scriptRes.status).toBe(200);
      const scriptText = await scriptRes.text();

      let onMessage: ((ev: unknown) => void) | undefined;
      const parentWin = {};
      vm.runInNewContext(scriptText, {
        window: {
          parent: parentWin,
          addEventListener: (t: string, cb: (ev: unknown) => void) => {
            if (t === 'message') onMessage = cb;
          },
          removeEventListener: () => {},
        },
      });
      const sent: Record<string, unknown>[] = [];
      onMessage?.({
        source: parentWin,
        origin: 'https://shop.ogabassey.com',
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-502',
          instanceId: 'inst-502',
          buildDigest: 'f'.repeat(64),
        },
        ports: [
          {
            start: () => {},
            postMessage: (m: Record<string, unknown>) => sent.push(m),
          },
        ],
      });
      expect(sent).toEqual([
        { type: 'ready', nonce: 'n-502', readiness: 'react-commit/v1' },
        { type: 'render-failed', nonce: 'n-502', code: 'HYDRATION_FAILED' },
      ]);
    } finally {
      await mf.dispose();
    }
  });
});

import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { parseWorkerStorefrontManifest } from '../schemas/worker-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';
import { buildContentSecurityPolicyHeader } from './csp-header';
import {
  buildSafeJsxRuntimeSource,
  JSX_RUNTIME_VIRTUAL_PATH,
} from './jsx-runtime-guard';
import { prebundleMerchantEntrySource } from './prebundle-merchant-entry';

describe('Round 48 JSX pragma blocking and composable vs full-code published-frame route alignment', () => {
  it('rejects classic JSX runtime pragmas, key-after-spread fallbacks, and real prebundle createElement escapes', async () => {
    const pragmaEscapes = [
      `/** @jsxRuntime classic */\nimport React from 'react';\nexport default function App() { const v = '/evil.example'; return <a href={\`/\${v}\`}>Go</a>; }`,
      `/* @jsx React.createElement */\nimport React from 'react';\nexport default function App() { return <main>classic</main>; }`,
      `// @jsxImportSource react\nexport default function App() { return <main>importSource</main>; }`,
      `/* @jsxFrag React.Fragment */\nimport React from 'react';\nexport default function App() { return <>frag</>; }`,
    ];
    for (const content of pragmaEscapes) {
      const m = createOgabasseyStorefrontManifest();
      m.files = [{ path: 'src/StorefrontApp.tsx', content }];
      let caught: unknown = null;
      try {
        await compileStorefrontWorker(m);
      } catch (err) {
        caught = err;
      }
      if (!(caught instanceof StorefrontCompilerError)) {
        throw new Error('Expected StorefrontCompilerError');
      }
      expect(caught.code).toBe('SOURCE_SAFETY_VIOLATION');
      expect(caught.message).toContain('JSX compiler pragma is forbidden');
    }

    // Key-after-spread on JSX elements is rejected in both compileStorefrontWorker and direct prebundleMerchantEntrySource
    const keyAfterSpreadManifest = createOgabasseyStorefrontManifest();
    keyAfterSpreadManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App() { const v = '/evil.example'; return <a {...{ className: 'btn' }} href={\`/\${v}\`} key="k">Go</a>; }`,
      },
    ];
    await expect(
      compileStorefrontWorker(keyAfterSpreadManifest)
    ).rejects.toMatchObject({
      code: 'SOURCE_SAFETY_VIOLATION',
    });

    // Direct prebundle check catches real `// source:` esbuild output even with framer-motion + fake template-literal header comments
    for (const rawSource of [
      `/** @jsxRuntime classic */\nimport React from 'react';\nexport default function App() { return <div>classic</div>; }`,
      `import { motion } from 'framer-motion';\nconst spoof = \`\\n// ../../node_modules/fake\\n\`;\nexport default function App() { return <motion.div>{spoof}<div {...{ id: 'x' }} key="k">hi</div></motion.div>; }`,
    ]) {
      const vf = new Map<string, string>([
        [JSX_RUNTIME_VIRTUAL_PATH, buildSafeJsxRuntimeSource('ogabassey')],
        ['src/StorefrontApp.tsx', rawSource],
      ]);
      await expect(
        prebundleMerchantEntrySource({
          entry: 'src/StorefrontApp.tsx',
          virtualFiles: vf,
          declaredPackages: new Set(['react', 'framer-motion']),
          declaredAssetIds: new Set(),
          targetRuntime: 'worker',
        })
      ).rejects.toMatchObject({
        code: 'SOURCE_SAFETY_VIOLATION',
      });
    }

    // String literals mentioning @jsxRuntime and key-before-spread with framer-motion compile cleanly
    const safeLiteral = createOgabasseyStorefrontManifest();
    safeLiteral.packages = [
      { name: 'react', versionRef: 'platform-pinned' },
      { name: 'framer-motion', versionRef: 'platform-pinned' },
    ];
    safeLiteral.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { motion } from 'framer-motion';\nexport default function App() { const doc = 'Note: @jsxRuntime automatic is enforced'; return <motion.main><div key="k" {...{ className: 'card' }}><p>{doc}</p><p>https://example.test/@jsx</p></div></motion.main>; }`,
      },
    ];
    const compiled = await compileStorefrontWorker(safeLiteral);
    expect(compiled.workerCode).toContain('enforced');
  });

  it('rejects /search, /cart, and non-host route shapes in composable mode while isolating full-code mode from published-frame embedding', () => {
    for (const badRoutes of [
      [
        { path: '/', view: 'home' as const },
        { path: '/search', view: 'search' as const },
      ],
      [
        { path: '/', view: 'home' as const },
        { path: '/cart', view: 'cart' as const },
      ],
      [
        { path: '/', view: 'home' as const },
        { path: '/:category', view: 'collection' as const },
      ],
      [
        { path: '/', view: 'home' as const },
        { path: '/pages/about', view: 'editorial' as const },
      ],
      [
        { path: '/', view: 'home' as const },
        { path: '/pages/[slug]', view: 'editorial' as const },
      ],
      [
        { path: '/', view: 'home' as const },
        { path: '/pages//story', view: 'editorial' as const },
      ],
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.mode = 'composable';
      m.routes = badRoutes;
      expect(() => parseWorkerStorefrontManifest(m)).toThrow();
    }

    const validComposable = createOgabasseyStorefrontManifest();
    validComposable.mode = 'composable';
    validComposable.routes = [
      { path: '/', view: 'home' },
      { path: '/collections/[handle]', view: 'collection' },
      { path: '/products/[handle]', view: 'product' },
      { path: '/pages/our-story', view: 'editorial' },
    ];
    expect(() => parseWorkerStorefrontManifest(validComposable)).not.toThrow();

    // full-code mode allows standalone /search & /cart on Worker but forbids published storefront framing
    const fullCode = createOgabasseyStorefrontManifest();
    fullCode.hostOrigin = 'https://shop.ogabassey.com';
    const fullCodeCsp = buildContentSecurityPolicyHeader(fullCode);
    const frameAncestorsDirective = fullCodeCsp.match(
      /frame-ancestors ([^;]+)/
    )?.[1];
    expect(frameAncestorsDirective).toBe('https://usebaci.com');

    // full-code client rejects published-host baci-experience-connect handshakes
    const entrySrc = buildClientHydrationEntrySource(
      'src/App.tsx',
      {},
      fullCode.routes,
      undefined,
      'https://shop.ogabassey.com',
      'full-code'
    );
    let onMsg: ((ev: unknown) => void) | undefined;
    const parentWin = {};
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
        parent: parentWin,
        addEventListener: (t: string, cb: (ev: unknown) => void) => {
          if (t === 'message') onMsg = cb;
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
    expect(onMsg).toBeDefined();
    const sent: unknown[] = [];
    for (const origin of [
      'https://ogabassey.usebaci.com',
      'https://shop.ogabassey.com',
    ]) {
      onMsg?.({
        source: parentWin,
        origin,
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-fc',
          instanceId: 'inst-fc',
          buildDigest: 'a'.repeat(64),
        },
        ports: [{ start: () => {}, postMessage: (m: unknown) => sent.push(m) }],
      });
    }
    expect(sent).toHaveLength(0);

    // Allowed Studio preview origin https://usebaci.com still connects cleanly
    onMsg?.({
      source: parentWin,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-preview',
        instanceId: 'inst-fc',
        buildDigest: 'a'.repeat(64),
      },
      ports: [{ start: () => {}, postMessage: (m: unknown) => sent.push(m) }],
    });
    expect(sent[0]).toEqual({
      type: 'ready',
      nonce: 'n-preview',
      readiness: 'react-commit/v1',
    });
  });
});

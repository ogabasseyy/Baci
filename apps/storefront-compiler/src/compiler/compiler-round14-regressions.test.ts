import vm from 'node:vm';
import { Miniflare, type Request as MiniflareRequest } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round-14 Codex & CodeRabbit resource APIs, JSX nav/spread safety, checkout.prepare, and lazy init', () => {
  it.each([
    [
      'react-dom preinit external script',
      `import { preinit } from 'react-dom';
       import { useEffect } from 'react';
       export default function X() {
         useEffect(() => { preinit('https://www.googletagmanager.com/gtm.js?id=X', { as: 'script' }); }, []);
         return <p>ok</p>;
       }`,
    ],
    [
      'react-dom preinitModule external module',
      `import { preinitModule } from 'react-dom';
       export default function X() {
         return <button type="button" onClick={() => { preinitModule('https://www.googletagmanager.com/m.js'); }}>ok</button>;
       }`,
    ],
    [
      'react-dom preload import',
      `import { preload } from 'react-dom';
       export default function X() {
         preload('https://www.googletagmanager.com/s.js', { as: 'script' });
         return <p>ok</p>;
       }`,
    ],
    [
      'external anchor href',
      `export default function X() {
         return <a href="https://evil.example/phish">Leave</a>;
       }`,
    ],
    [
      'JSX spread external href',
      `export default function X() {
         return <a {...{ href: 'https://evil.example/phish' }}>Leave</a>;
       }`,
    ],
    [
      'const tail protocol-relative open redirect',
      `export default function X() {
         const tail = '/evil.example';
         return <a href={\`/\${tail}\`}>Leave</a>;
       }`,
    ],
    [
      'merchant-created target.merchantSlug host spoof',
      `export default function X() {
         const target = { merchantSlug: 'evil.example/#' };
         return <a href={\`https://\${target.merchantSlug}.usebaci.com/cart\`}>Leave</a>;
       }`,
    ],
    [
      'imperative ref.current.click()',
      `import { useEffect, useRef } from 'react';
       export default function X() {
         const ref = useRef<HTMLAnchorElement>(null);
         useEffect(() => { ref.current?.click(); }, []);
         return <a ref={ref} href="/smartphones">Go</a>;
       }`,
    ],
    [
      'imperative form.submit()',
      `import { useRef } from 'react';
       export default function X() {
         const ref = useRef<HTMLFormElement>(null);
         return <form ref={ref} action="/cart"><button type="button" onClick={() => ref.current?.submit()}>Go</button></form>;
       }`,
    ],
  ])('blocks resource injection and open-redirect/activation sinks: %s', async (_label, code) => {
    const m = createOgabasseyStorefrontManifest();
    m.packages.push({ name: 'react-dom', versionRef: 'platform-pinned' });
    m.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(m)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('allows standard <video preload="none" /> media attributes and sanitizes runtime protocol-relative JSX hrefs', async () => {
    const m = createOgabasseyStorefrontManifest();
    m.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          export default function App(props: { products: Array<{ slug: string }> }) {
            const dynamicSlug = props.products[0]?.slug ?? 'safe';
            return (
              <main>
                <video preload="none" src="/assets/hero-banner" />
                <a {...{ href: '/smartphones', id: 'safe-spread' }}>Phones</a>
                <a id="dyn-link" href={\`/\${dynamicSlug}\`}>Item</a>
              </main>
            );
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(m);
    const mf = new Miniflare({
      modules: [
        {
          type: 'ESModule',
          path: 'index.mjs',
          contents: compiled.workerCode,
        },
      ],
      compatibilityDate: '2026-04-01',
      outboundService: async (_req: MiniflareRequest) =>
        new Response(
          JSON.stringify({
            products: [{ slug: '/evil.example/hijack' }],
            facets: { brands: [], conditions: [], totalMatches: 1 },
          }),
          { headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('preload="none"');
      expect(html).toContain('href="/smartphones"');
      expect(html).toContain('id="dyn-link" href="#"');
      expect(html).not.toContain('//evil.example');
    } finally {
      await mf.dispose();
    }
  });

  it('returns CART_ENROLLMENT_REQUIRED for checkout.prepare before enrollment and contains browser-only init errors', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          if (typeof window !== 'undefined') {
            throw new Error('Browser-only top-level failure');
          }
          export default function App() { return <main>SSR ok</main>; }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.clientCode).toContain('CART_ENROLLMENT_REQUIRED');

    const entrySrc = buildClientHydrationEntrySource(
      'src/StorefrontApp.tsx',
      {}
    );
    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; code?: string; value?: unknown }>)
      | undefined;

    const stubBody = entrySrc
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
        'await import("./src/StorefrontApp.tsx")',
        'await Promise.reject(new Error("Browser-only top-level failure"))'
      );

    const winMock = {
      location: { origin: 'https://ogabassey.mybaci.store', assign: () => {} },
      parent: null as unknown,
      open: () => null,
    };
    winMock.parent = winMock;

    expect(() =>
      vm.runInNewContext(stubBody, {
        URL,
        __capture: (fn: typeof capturedTransport) => {
          capturedTransport = fn;
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
      })
    ).not.toThrow();

    if (!capturedTransport) throw new Error('Expected transport');
    const prep = await capturedTransport('checkout.prepare', {});
    expect(prep).toMatchObject({
      status: 'error',
      code: 'CART_ENROLLMENT_REQUIRED',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

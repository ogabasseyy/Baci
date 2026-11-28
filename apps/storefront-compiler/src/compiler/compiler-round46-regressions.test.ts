import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

async function expectSourceSafetyRejection(
  content: string,
  expectedSnippet: string
): Promise<void> {
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
  expect(caught.message).toContain(expectedSnippet);
}

describe('Round 46 container DOM subobjects, queued navigation queries, and SSR browser global safety', () => {
  it('rejects mutating DOM subobjects stored in array/object/collection containers while allowing benign field writes and reads', async () => {
    const escapes = [
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement | null>(null); return <a ref={ref} href="/smartphones" onClick={() => { const box = [ref.current?.attributes['href']]; if (box[0]) box[0].value = 'https://evil.example'; }}>Go</a>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement | null>(null); return <a ref={ref} href="/smartphones" onClick={() => { const holder = { attr: ref.current?.attributes[0] }; if (holder.attr) holder.attr.value = 'https://evil.example'; }}>Go</a>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement | null>(null); return <a ref={ref} href="/smartphones" onClick={() => { const list: Array<{ value: string }> = []; list.push(ref.current?.attributes['href'] as unknown as { value: string }); list[0].value = 'https://evil.example'; }}>Go</a>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement | null>(null); return <a ref={ref} href="/smartphones" onClick={() => { for (const item of [ref.current?.attributes['href']]) { if (item) item.value = 'https://evil.example'; } }}>Go</a>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement | null>(null); return <a ref={ref} href="/smartphones" onClick={() => { [ref.current?.attributes['href']].forEach((item) => { if (item) item.value = 'https://evil.example'; }); }}>Go</a>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement | null>(null); return <a ref={ref} href="/smartphones" onClick={() => { ((item) => { if (item) item.value = 'https://evil.example'; })(ref.current?.attributes['href']); }}>Go</a>; }`,
    ];
    for (const content of escapes) {
      await expectSourceSafetyRejection(content, 'DOM resource mutation');
    }

    const benign = createOgabasseyStorefrontManifest();
    benign.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { useRef } from 'react';
        function helperA(el: HTMLAnchorElement | null) { const box: unknown[] = []; box.push(el?.attributes[0]); return box.length; }
        export default function App() {
          const ref = useRef<HTMLAnchorElement | null>(null);
          const state = { domStyle: ref.current?.style, card: { label: 'Old' } };
          state.card.label = '16GB';
          const box = [{ label: 'Clean' }];
          box[0].label = 'Updated';
          return <main onClick={() => { void helperA(ref.current); }}>{state.card.label}-{box[0].label}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(benign);
    expect(compiled.workerCode).toContain('16GB');
  });

  it('associates pending queries with their queued framed navigation and clears failed navigations', async () => {
    const entrySrc = buildClientHydrationEntrySource(
      'src/App.tsx',
      {},
      [
        { path: '/', view: 'home' },
        { path: '/search', view: 'search' },
      ],
      undefined,
      'https://ogabassey.usebaci.com'
    );
    interface CapturedCommerce {
      navigation: { go: (p: string) => Promise<{ status: string }> };
    }
    const holder: { commerce?: CapturedCommerce } = {};
    const winMessages: ((ev: unknown) => void)[] = [];
    const fetchedUrls: string[] = [];
    let nextEpoch = 1;
    let failNextGo = false;

    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => p.children; const createCommerceClient = (transport) => { const c = { navigation: { go: (path) => transport("navigation.go", { path }), open: (path) => transport("navigation.open", { path }) }, checkout: { open: () => transport("checkout.open", {}) } }; __captureCommerce(c); return c; };'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = () => ({}); const useEffect = (fn) => { fn(); };'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => ({ render: () => {} });'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );

    const parentFrame = {};
    vm.runInNewContext(stubBody, {
      URL,
      URLSearchParams,
      WeakSet,
      AbortController,
      setTimeout,
      clearTimeout,
      __captureCommerce: (c: CapturedCommerce) => {
        holder.commerce = c;
      },
      fetch: async (url: string) => {
        fetchedUrls.push(url);
        return {
          json: async () => ({
            status: 'ok',
            value: {
              view: 'search',
              title: 'Search',
              products: [],
              facets: { brands: [], conditions: [], totalMatches: 0 },
            },
          }),
        };
      },
      window: {
        location: { origin: 'null', assign: () => {} },
        parent: parentFrame,
        addEventListener: (t: string, cb: (ev: unknown) => void) => {
          if (t === 'message') winMessages.push(cb);
        },
      },
      document: {
        baseURI: 'https://ogabassey.mybaci.store/',
        getElementById: (id: string) =>
          id === 'root'
            ? { addEventListener: () => {} }
            : {
                textContent:
                  '{"view":"home","pathname":"/","workerOrigin":"https://ogabassey.mybaci.store","merchantSlug":"ogabassey","publicDataRevision":"1:1"}',
              },
      },
    });
    await new Promise((r) => setImmediate(r));

    const fakePort: {
      onmessage: ((e: { data: unknown }) => void) | null;
      start: () => void;
      postMessage: (msg: Record<string, unknown>) => void;
    } = {
      onmessage: null,
      start: () => {},
      postMessage: (msg: Record<string, unknown>) => {
        if (msg.protocol !== 'baci-commerce/1') return;
        setImmediate(() => {
          if (failNextGo) {
            failNextGo = false;
            fakePort.onmessage?.({
              data: {
                type: 'result',
                requestId: msg.requestId,
                result: { status: 'error', code: 'NOT_FOUND', message: 'No' },
              },
            });
            return;
          }
          const ep = ++nextEpoch;
          const route = {
            epoch: ep,
            routeId: 'search',
            params: {},
            canonicalPath: '/search',
            publicDataRevision: '1:1',
          };
          const emitBoot = () =>
            fakePort.onmessage?.({
              data: {
                type: 'bootstrap',
                bootstrap: { route, catalog: { products: [] } },
              },
            });
          const emitRes = () =>
            fakePort.onmessage?.({
              data: {
                type: 'result',
                requestId: msg.requestId,
                result: { status: 'ok', value: route },
              },
            });
          if (ep % 2 === 0) {
            emitRes();
            setImmediate(emitBoot);
          } else {
            emitBoot();
            setImmediate(emitRes);
          }
        });
      },
    };
    for (const fn of winMessages) {
      fn({
        origin: 'https://ogabassey.usebaci.com',
        source: parentFrame,
        data: {
          type: 'baci-experience-connect',
          nonce: 'n-46',
          instanceId: 'inst-46',
          buildDigest: 'f'.repeat(64),
        },
        ports: [fakePort],
      });
    }

    if (!holder.commerce) throw new Error('Expected commerce client');
    const [r1, r2] = await Promise.all([
      holder.commerce.navigation.go('/search?q=a'),
      holder.commerce.navigation.go('/search?q=b'),
    ]);
    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(fetchedUrls).toEqual([
      'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2Fsearch%3Fq%3Da',
      'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2Fsearch%3Fq%3Db',
    ]);

    failNextGo = true;
    const failed = await holder.commerce.navigation.go('/search?q=stale');
    expect(failed.status).toBe('error');
    const clean = await holder.commerce.navigation.go('/search');
    expect(clean.status).toBe('ok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(fetchedUrls).toEqual([
      'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2Fsearch%3Fq%3Da',
      'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2Fsearch%3Fq%3Db',
      'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2Fsearch',
    ]);
  });

  it('rejects unguarded SSR browser global reads while allowing typeof guards and browser-only callbacks', async () => {
    const ssrCrashes = [
      `const title = document.title;\nexport default function App() { return <main>{title}</main>; }`,
      `export default function App() { return <main>{document.title}</main>; }`,
      `export default function App() { return <main>{window.innerWidth}</main>; }`,
      `export default function App() { return <main>{navigator.language}</main>; }`,
      `export default function App() { return <main>{globalThis.document.title}</main>; }`,
      `function base(t: string) { void t; return class {}; }\nclass Leak extends base(document.title) {}\nexport default function App() { void Leak; return <main>x</main>; }`,
      `function useEffect(fn: () => string) { return fn(); }\nexport default function App() { return <main>{useEffect(() => document.title)}</main>; }`,
      `function Custom(p: { onClick: () => string }) { return <p>{p.onClick()}</p>; }\nexport default function App() { return <Custom onClick={() => document.title} />; }`,
      `export default function App() { return <button type="button" onClick={(() => { void document.title; return () => {}; })()}>Go</button>; }`,
    ];
    for (const content of ssrCrashes) {
      await expectSourceSafetyRejection(
        content,
        'Unguarded SSR read of browser global'
      );
    }

    const safeManifest = createOgabasseyStorefrontManifest();
    safeManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import * as React from 'react';
        import { useEffect } from 'react';
        const initialTitle = typeof (globalThis['document']) !== 'undefined' ? (globalThis.document)?.title ?? 'Ogabassey' : 'Ogabassey';
        function readGuarded(): string { if (typeof document === 'undefined') return 'SSR'; return document.title; }
        export default function App() {
          useEffect(() => { const t = document.title; const w = window.innerWidth; void t; void w; }, []);
          React['useEffect'](() => { void document.title; }, []);
          return <main><h1>{initialTitle} - {readGuarded()}</h1><button type="button" onClick={() => { void document.title; }}>Check</button></main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(safeManifest);
    expect(compiled.workerCode).toContain('Ogabassey');
  });
});

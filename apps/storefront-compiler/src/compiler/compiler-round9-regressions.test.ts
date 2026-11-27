import vm from 'node:vm';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { parseWorkerStorefrontManifest } from '../schemas/worker-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';
import { buildContentSecurityPolicyHeader } from './csp-header';

describe('Round-9 Codex Object.assign, CSP wildcard, popup presented, route normalization, and SSR error containment', () => {
  it.each([
    [
      'Object.assign DOM raw-HTML write',
      `export default function X() {
         return <button type="button" onClick={() => { Object.assign(document.body, JSON.parse('{"innerHTML":"<b>x</b>"}')); }}>ok</button>;
       }`,
    ],
    [
      'Object.assign alias destructuring',
      `export default function X() {
         const { assign } = Object;
         return <p>{String(Boolean(assign))}</p>;
       }`,
    ],
    [
      'document.createElementNS script injection',
      `export default function X() {
         return <button type="button" onClick={() => { document.createElementNS('http://www.w3.org/1999/xhtml', 'script'); }}>ok</button>;
       }`,
    ],
    [
      'JSX <script> element',
      `export default function X() {
         return <script>{'alert(1)'}</script>;
       }`,
    ],
  ])('blocks indirect DOM/HTML injection: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('allows safe spread-free Object.assign({}, { ... }) and benign { assign } labels', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function X() {
          const merged = Object.assign({}, { mode: 'grid' });
          const labels = JSON.stringify({ assign: 'Assign serial' });
          return <main>{merged.mode}:{labels}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.workerCode.length).toBeGreaterThan(500);
  });

  it('emits zero wildcards in CSP img-src and form-action when manifest declares no extra origins', () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.cspAllowlist = {
      scriptOrigins: [],
      connectOrigins: [],
      imgOrigins: [],
    };
    const csp = buildContentSecurityPolicyHeader(manifest);
    expect(csp).not.toContain('supabase.co');
    expect(csp).not.toContain('*');
    expect(csp).toContain('https://ogabassey.usebaci.com');
  });

  it('reports { presented: false } when window.open is popup-blocked and { presented: true } with opener severed when allowed', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {});
    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown }>)
      | undefined;

    let popupBlocked = false;
    const openedHandle: { opener: unknown } = { opener: { secret: 1 } };

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
        'import StorefrontApp from "./src/App.tsx";',
        'const StorefrontApp = () => null;'
      );

    const winMock = {
      location: {
        origin: 'https://ogabassey.mybaci.store',
        assign: () => {},
      },
      parent: null as unknown,
      open: () => (popupBlocked ? null : openedHandle),
    };
    winMock.parent = winMock;

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
    });

    if (!capturedTransport) throw new Error('Expected transport');

    const allowed = await capturedTransport('navigation.open', {
      path: '/smartphones',
    });
    expect(allowed).toEqual({ status: 'ok', value: { presented: true } });
    expect(openedHandle.opener).toBeNull();

    popupBlocked = true;
    const blocked = await capturedTransport('navigation.open', {
      path: '/smartphones',
    });
    expect(blocked).toEqual({ status: 'ok', value: { presented: false } });
  });

  it('rejects routes that normalize to the same matcher pattern (/cart vs /cart/, /:category vs /:slug vs /[handle])', () => {
    const trailingDup = createOgabasseyStorefrontManifest();
    trailingDup.routes.push({ path: '/cart/', view: 'editorial' });
    expect(() => parseWorkerStorefrontManifest(trailingDup)).toThrow(
      /Duplicate normalized route pattern/
    );

    const dynamicDup = createOgabasseyStorefrontManifest();
    dynamicDup.routes.push({ path: '/:slug', view: 'editorial' });
    expect(() => parseWorkerStorefrontManifest(dynamicDup)).toThrow(
      /Duplicate normalized route pattern/
    );

    const bracketDup = createOgabasseyStorefrontManifest();
    bracketDup.routes.push({ path: '/[handle]', view: 'editorial' });
    expect(() => parseWorkerStorefrontManifest(bracketDup)).toThrow(
      /Duplicate normalized route pattern/
    );

    const cssEntry = createOgabasseyStorefrontManifest();
    cssEntry.files.push({
      path: 'src/only.css',
      content: '.a { color: red; }',
    });
    cssEntry.entry = 'src/only.css';
    expect(() => parseWorkerStorefrontManifest(cssEntry)).toThrow(/executable/);
  });

  it('contains top-level merchant module-evaluation failures before fetch() and serves bounded 500 with CSP', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          const brokenTopLevelWidth = window.innerWidth;
          export default function App() {
            return <main>{String(brokenTopLevelWidth)}</main>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify({
            title: 'Home',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(res.status).toBe(500);
      expect(res.headers.get('content-security-policy')).toContain(
        "default-src 'self'"
      );
      const html = await res.text();
      expect(html).toContain('noindex, nofollow');
      expect(html).toContain('Storefront Render Error');
      expect(html).not.toContain('__BACI_STOREFRONT_STATE__');
    } finally {
      await mf.dispose();
    }

    // Also permits valid object-valued React default exports such as forwardRef(...)
    const forwardRefManifest = createOgabasseyStorefrontManifest();
    forwardRefManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { forwardRef } from 'react';
export default forwardRef<HTMLElement, { title: string }>(function App(props, ref) { return <main ref={ref}>{props.title}</main>; });`,
      },
    ];
    const forwardRefCompiled =
      await compileStorefrontWorker(forwardRefManifest);
    const mfOk = new Miniflare({
      modules: [
        {
          type: 'ESModule',
          path: 'worker.mjs',
          contents: forwardRefCompiled.workerCode,
        },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify({
            title: 'ForwardRef Home',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const okRes = await mfOk.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(okRes.status).toBe(200);
      expect(await okRes.text()).toContain('ForwardRef Home');
    } finally {
      await mfOk.dispose();
    }
  });

  it('contains merchant SSR exceptions inside fetch() and serves a bounded 500 fallback with CSP and noindex', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function CrashingApp(props: { productDetail: { name: string } | null }) {
          if (!props.productDetail) {
            throw new Error('Merchant bug: dereferenced missing productDetail on home');
          }
          return <main>{props.productDetail.name}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify({
            title: 'Home',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(res.status).toBe(500);
      expect(res.headers.get('content-security-policy')).toContain(
        "default-src 'self'"
      );
      const html = await res.text();
      expect(html).toContain('noindex, nofollow');
      expect(html).toContain('Storefront Render Error');
      expect(html).not.toContain('__BACI_STOREFRONT_STATE__');
      expect(html).not.toContain('Merchant bug');
    } finally {
      await mf.dispose();
    }
  });
});

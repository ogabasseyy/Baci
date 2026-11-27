import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Muse PR #4493 security, routing, CSP, and malformed-URI regressions', () => {
  it.each([
    [
      'computed dangerouslySetInnerHTML in createElement',
      `import { createElement } from 'react';
       export default function X() {
         return createElement('div', { ['dangerously' + 'SetInnerHTML']: { __html: '<b>xss</b>' } });
       }`,
    ],
    [
      'string-concatenated globalThis eval',
      `export default function X() {
         const r = globalThis['ev' + 'al']('1+1');
         return <p>{String(r)}</p>;
       }`,
    ],
    [
      'aliased globalThis.Function constructor',
      `export default function X() {
         const F = globalThis.Function;
         return <p>{String(F('return 1')())}</p>;
       }`,
    ],
    [
      'prototype .constructor Function escape',
      `export default function X() {
         const fn = (() => {})['construc' + 'tor']('return 1');
         return <p>{String(fn())}</p>;
       }`,
    ],
    [
      'computed document["cookie"] access',
      `export default function X() {
         return <p>{document['coo' + 'kie']}</p>;
       }`,
    ],
    [
      'computed navigator["serviceWorker"] access',
      `export default function X() {
         return <p>{String(navigator['service' + 'Worker'])}</p>;
       }`,
    ],
    [
      'dynamic bracket indexing on window',
      `export default function X({ k }: { k: string }) {
         return <p>{String((window as unknown as Record<string, unknown>)[k])}</p>;
       }`,
    ],
    [
      'destructuring Function via { constructor }',
      `export default function X() {
         const { constructor: F } = () => {};
         return <p>{String(F)}</p>;
       }`,
    ],
    [
      'aliased document global with bracket indexing',
      `export default function X({ k }: { k: string }) {
         const d = document;
         return <p>{String((d as unknown as Record<string, unknown>)[k])}</p>;
       }`,
    ],
    [
      'passing sensitive global location as argument',
      `export default function X() {
         const read = (l: Location) => l.href;
         return <p>{read(location)}</p>;
       }`,
    ],
    [
      'non-literal bracket indexing on function expression',
      `export default function X({ k }: { k: string }) {
         const fn = ((() => {}) as unknown as Record<string, (s: string) => () => number>)[k]('return 1');
         return <p>{String(fn())}</p>;
       }`,
    ],
    [
      'numeric bracket indexing on window global',
      `export default function X() {
         return <p>{String(window[0])}</p>;
       }`,
    ],
    [
      'destructuring cookie from object',
      `export default function X({ obj }: { obj: { cookie: string } }) {
         const { cookie } = obj;
         return <p>{cookie}</p>;
       }`,
    ],
    [
      'dot property access .cookie',
      `export default function X({ obj }: { obj: { cookie: string } }) {
         return <p>{obj.cookie}</p>;
       }`,
    ],
    [
      'bracket property access ["cookie"]',
      `export default function X({ obj }: { obj: Record<string, string> }) {
         return <p>{obj['cookie']}</p>;
       }`,
    ],
  ])('AST source guard blocks %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];

    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('allows class constructors, benign data object keys, numeric array indexing, and typeof window', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          class Helper {
            constructor(public readonly label: string) {}
          }
          export default function X() {
            const helper = new Helper('Acme Devices');
            const items = ['alpha', 'beta'];
            const meta = { constructor: helper.label, cookie: 'chocolate', serviceWorker: 'none', title: 'Bakery' };
            const hasWin = typeof window !== 'undefined';
            return <p>{items[0]}-{meta.title}-{String(hasWin)}</p>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.buildDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('strips __spoof_merchant and x-baci-merchant-slug from workerCode and canonicalizes search params', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.workerCode).not.toContain('__spoof_merchant');
    expect(compiled.workerCode).not.toContain('x-baci-merchant-slug');

    const upstreamUrls: string[] = [];
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: (req: MiniflareRequest) => {
        upstreamUrls.push(req.url);
        return new MiniflareResponse(
          JSON.stringify({
            title: 'Search',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    });
    try {
      const spoofedHeaderRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/search?q=phone&nonce=1&merchantId=evil',
        { headers: { 'x-baci-merchant-slug': 'evil-slug' } }
      );
      const html1 = await spoofedHeaderRes.text();
      expect(html1).toContain('"merchantSlug":"ogabassey"');
      expect(html1).not.toContain('evil-slug');

      await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/search?nonce=2&q=phone&slug=evil'
      );
      expect(upstreamUrls).toEqual([
        'https://catalog.baci.internal/v1/search?q=phone',
        'https://catalog.baci.internal/v1/search?q=phone',
      ]);
    } finally {
      await mf.dispose();
    }
  });

  it('enforces CSP header, declared-route-only dispatch (including editorial), and 502 upstream resilience', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/pages/:slug', view: 'editorial' },
    ];
    const compiled = await compileStorefrontWorker(manifest);

    let upstreamCalls = 0;
    let upstreamMode: 'ok' | '403' | 'bad-json' = 'ok';

    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: () => {
        upstreamCalls += 1;
        if (upstreamMode === '403') {
          return new MiniflareResponse('Forbidden', { status: 403 });
        }
        if (upstreamMode === 'bad-json') {
          return new MiniflareResponse('<html>not-json</html>', {
            status: 200,
          });
        }
        return new MiniflareResponse(
          JSON.stringify({
            title: 'Home',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    });

    try {
      const homeRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(homeRes.status).toBe(200);
      expect(upstreamCalls).toBe(1);
      const csp = homeRes.headers.get('content-security-policy') ?? '';
      expect(csp).toContain(
        "script-src 'self' https://www.googletagmanager.com"
      );
      expect(csp).toContain(
        "connect-src 'self' https://api.usebaci.com https://www.google-analytics.com"
      );
      expect(csp).toContain("worker-src 'none'");
      expect(csp).toContain(
        "form-action 'self' https://ogabassey.usebaci.com https://usebaci.com"
      );

      // Editorial route renders 200 without upstream catalog calls.
      const editorialRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/pages/warranty-policy'
      );
      expect(editorialRes.status).toBe(200);
      expect(upstreamCalls).toBe(1);
      expect(await editorialRes.text()).toContain('warranty-policy');

      // Malformed percent-encoding on :slug returns 400 with CSP without throwing URIError.
      const badUriRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/pages/%FF'
      );
      expect(badUriRes.status).toBe(400);
      expect(badUriRes.headers.get('content-security-policy')).toBeTruthy();
      expect(upstreamCalls).toBe(1);

      // Undeclared 1-segment route (/smartphones) 404s WITHOUT calling upstream catalog RPC!
      const undeclaredRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones'
      );
      expect(undeclaredRes.status).toBe(404);
      expect(upstreamCalls).toBe(1);
      expect(undeclaredRes.headers.get('content-security-policy')).toBeTruthy();

      // Upstream 403 / non-JSON returns controlled 502 with noindex + CSP, never 500 crash.
      upstreamMode = '403';
      const err403 = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(err403.status).toBe(502);
      expect(err403.headers.get('content-security-policy')).toBeTruthy();
      expect(await err403.text()).toContain('noindex, nofollow');

      upstreamMode = 'bad-json';
      const errJson = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(errJson.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });
});

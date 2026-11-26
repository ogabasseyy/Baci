import { Miniflare, Response as MiniflareResponse } from 'miniflare';
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
  ])('AST source guard blocks %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];

    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('allows harmless non-computed { constructor: "Acme" } data properties in object literals', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function X() { const meta = { constructor: 'Acme Devices' }; return <p>{meta.title ?? 'ok'}</p>; }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.buildDigest).toMatch(/^[a-f0-9]{64}$/);
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
      expect(csp).toContain("form-action 'self' https://*.usebaci.com");

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

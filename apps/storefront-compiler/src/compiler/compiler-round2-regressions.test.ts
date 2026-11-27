import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round-2 & Round-3 Codex & Muse compiler hardening regressions', () => {
  it('computes sourceDigest over the full manifest, preserving behavioral route order and deterministic CSS cascade', async () => {
    const base = createOgabasseyStorefrontManifest();
    base.files.push(
      { path: 'src/styles/z-theme.css', content: '.tone { color: #111827; }' },
      { path: 'src/styles/a-theme.css', content: '.tone { color: #2563eb; }' }
    );
    const first = await compileStorefrontWorker(base);

    const reorderedFilesAndPkgs = structuredClone(base);
    reorderedFilesAndPkgs.files = [...reorderedFilesAndPkgs.files].reverse();
    reorderedFilesAndPkgs.packages = [
      ...reorderedFilesAndPkgs.packages,
    ].reverse();
    const reorderedCompiled = await compileStorefrontWorker(
      reorderedFilesAndPkgs
    );
    expect(reorderedCompiled.sourceDigest).toBe(first.sourceDigest);
    expect(reorderedCompiled.cssCode).toBe(first.cssCode);

    // Reordering routes changes match precedence (/search vs /:category) and MUST change sourceDigest.
    const reversedRoutes = structuredClone(base);
    reversedRoutes.routes = [...reversedRoutes.routes].reverse();
    expect(
      (await compileStorefrontWorker(reversedRoutes)).sourceDigest
    ).not.toBe(first.sourceDigest);

    const changedTheme = structuredClone(base);
    changedTheme.themeTokens.accent = '#ff3366';
    expect((await compileStorefrontWorker(changedTheme)).sourceDigest).not.toBe(
      first.sourceDigest
    );

    const changedCsp = structuredClone(base);
    changedCsp.cspAllowlist.scriptOrigins.push('https://analytics.tiktok.com');
    expect((await compileStorefrontWorker(changedCsp)).sourceDigest).not.toBe(
      first.sourceDigest
    );
  });

  it('rejects CSS injection payloads in themeTokens and allows safe CSS colors', async () => {
    const injected = createOgabasseyStorefrontManifest();
    injected.themeTokens.primary = 'red;} body{display:none}/*';
    await expect(compileStorefrontWorker(injected)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );

    const arbitraryIdent = createOgabasseyStorefrontManifest();
    arbitraryIdent.themeTokens.primary = 'rgb(var)';
    await expect(
      compileStorefrontWorker(arbitraryIdent)
    ).rejects.toBeInstanceOf(StorefrontCompilerError);

    const relativeColor = createOgabasseyStorefrontManifest();
    relativeColor.themeTokens.accent = 'oklch(from red l c h)';
    await expect(compileStorefrontWorker(relativeColor)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );

    const validColors = createOgabasseyStorefrontManifest();
    validColors.themeTokens = {
      primary: '#111827',
      secondary: 'rgb(248 250 252)',
      accent: 'oklch(0.65 0.2 250 / 80%)',
    };
    const compiled = await compileStorefrontWorker(validColors);
    expect(compiled.buildDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('permits @baci/shared root imports with transitive zod dependency', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.packages.push({
      name: '@baci/shared',
      versionRef: 'platform-pinned',
    });
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import { CANONICAL_PRODUCT_CONDITION_PREFERENCE } from '@baci/shared';
          export default function SharedApp() {
            return <main><p>{CANONICAL_PRODUCT_CONDITION_PREFERENCE.join(',')}</p></main>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.workerCode).toContain('open_box');
  });

  it('rejects self-referential and mutually cyclic CSS @import graphs with INVALID_MANIFEST', async () => {
    const selfCycle = createOgabasseyStorefrontManifest();
    selfCycle.files = [
      { path: 'src/styles/a.css', content: '@import "./a.css";' },
      {
        path: 'src/StorefrontApp.tsx',
        content: `import './styles/a.css'; export default function X(){return <main>ok</main>;}`,
      },
    ];
    await expect(compileStorefrontWorker(selfCycle)).rejects.toMatchObject({
      code: 'INVALID_MANIFEST',
    });

    const mutualCycle = createOgabasseyStorefrontManifest();
    mutualCycle.files = [
      { path: 'src/styles/a.css', content: '@import "./b.css";' },
      { path: 'src/styles/b.css', content: '@import "./a.css";' },
      {
        path: 'src/StorefrontApp.tsx',
        content: `import './styles/a.css'; export default function X(){return <main>ok</main>;}`,
      },
    ];
    await expect(compileStorefrontWorker(mutualCycle)).rejects.toMatchObject({
      code: 'INVALID_MANIFEST',
    });
  });

  it('blocks dangerous class fields, non-static JSX/createElement spread props, and undeclared catalog paths', async () => {
    for (const badCode of [
      `class Payload { dangerouslySetInnerHTML = { __html: '<b>xss</b>' }; }
       export default function X() { return <div {...new Payload()} />; }`,
      `import { createElement } from 'react';
       export default function X() { return createElement('div', JSON.parse('{}')); }`,
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.files = [{ path: 'src/StorefrontApp.tsx', content: badCode }];
      await expect(compileStorefrontWorker(m)).rejects.toBeInstanceOf(
        StorefrontCompilerError
      );
    }

    const merchantId = '00000000-0000-4000-8000-000000000001';
    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId,
      products: generateOgabasseyBackingCatalog(4),
    });
    const undeclaredPathRes = await plane.handleOutboundFetch(
      new Request('https://catalog.baci.internal/v1/undeclared?q=phone'),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(undeclaredPathRes.status).toBe(403);
    const postMethodRes = await plane.handleOutboundFetch(
      new Request('https://catalog.baci.internal/v1/search?q=phone', {
        method: 'POST',
      }),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(postMethodRes.status).toBe(403);
    expect(plane.telemetry.originCatalogRpcCalls).toBe(0);

    // Verify package.json specifiers match pnpm-lock.yaml importer.
    const pkgRoot = path.resolve(import.meta.dirname, '../..');
    const pkgJson = JSON.parse(
      readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const lockfile = readFileSync(
      path.resolve(pkgRoot, '../../pnpm-lock.yaml'),
      'utf8'
    );
    expect(lockfile).toContain(`specifier: ${pkgJson.dependencies.esbuild}`);
    expect(lockfile).toContain(
      `specifier: ${pkgJson.devDependencies['@types/react']}`
    );
  });
});

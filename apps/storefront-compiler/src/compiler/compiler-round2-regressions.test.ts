import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round-2 Codex & Muse compiler hardening regressions', () => {
  it('computes sourceDigest over the full canonicalized manifest while remaining invariant to ordering', async () => {
    const base = createOgabasseyStorefrontManifest();
    const first = await compileStorefrontWorker(base);

    const reordered = structuredClone(base);
    reordered.files = [...reordered.files].reverse();
    reordered.routes = [...reordered.routes].reverse();
    reordered.packages = [...reordered.packages].reverse();
    const reorderedCompiled = await compileStorefrontWorker(reordered);
    expect(reorderedCompiled.sourceDigest).toBe(first.sourceDigest);

    const changedRoutes = structuredClone(base);
    changedRoutes.routes.push({ path: '/about', view: 'editorial' });
    expect(
      (await compileStorefrontWorker(changedRoutes)).sourceDigest
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
});

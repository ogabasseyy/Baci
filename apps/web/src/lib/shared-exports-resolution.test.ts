import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Exercises the real package.json `exports` map of @baci/shared via
// Node resolution (createRequire), bypassing the Vitest aliases and
// Jest/tsconfig mappers that otherwise rewrite these specifiers, so a
// missing/misspelled exports entry fails here. This proves path
// resolution through the exports map only; it does not prove a
// production Next/Metro build can load the modules.
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);
const sharedPackageDir = join(repoRoot, 'packages/shared');
const appRequire = createRequire(join(repoRoot, 'apps/web/package.json'));

// Derived, not hard-coded: every test-fixtures file and the domain
// subpaths this PR added must have an exports entry, and every
// exports entry is resolved below.
const pkg = JSON.parse(
  readFileSync(join(sharedPackageDir, 'package.json'), 'utf8')
) as { exports: Record<string, string> };
const fixtureRoot = join(sharedPackageDir, 'src/test-fixtures');
const listFixtureFiles = (dir: string, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return listFixtureFiles(join(dir, entry.name), rel);
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.[tj]sx?$/.test(entry.name)
      ? [rel]
      : [];
  });
const fixtureSubpaths = listFixtureFiles(fixtureRoot).map(
  (rel) => `@baci/shared/test-fixtures/${rel.replace(/\.tsx?$/, '')}`
);
const subpaths = [
  ...Object.keys(pkg.exports)
    .filter((key) => key.startsWith('./test-fixtures/') || key === './vtu')
    .map((key) => `@baci/shared${key.slice(1)}`),
];

// Hard-coded expectations for the subpaths this PR adds: deriving the
// list from package.json alone would be tautological for these.
const expectedSubpaths = [
  '@baci/shared/vtu',
  '@baci/shared/test-fixtures/builder-ai-edit',
  '@baci/shared/test-fixtures/piggyvest-purchase',
  '@baci/shared/test-fixtures/piggyvest-device-change',
  '@baci/shared/test-fixtures/piggyvest-protected-offer',
  '@baci/shared/test-fixtures/piggyvest-draft-closure',
  '@baci/shared/test-fixtures/piggyvest-schedule',
  '@baci/shared/test-fixtures/fixture-mock',
  '@baci/shared/test-fixtures/order-wallet-funding-intent',
];

describe('@baci/shared exports resolution (no test aliases)', () => {
  it('exports map contains every expected new subpath', () => {
    for (const specifier of expectedSubpaths) {
      expect(subpaths, specifier).toContain(specifier);
    }
  });

  it('every test-fixtures file has an exports entry', () => {
    for (const specifier of fixtureSubpaths) {
      expect(subpaths, specifier).toContain(specifier);
    }
  });

  it('resolves every pinned new subpath (expectedSubpaths) through the exports map to its exact file; future non-fixture domain subpaths must be added to expectedSubpaths to be pinned', () => {
    const expectedTargets: Record<string, string> = {
      '@baci/shared/vtu': 'src/vtu/index.ts',
      '@baci/shared/test-fixtures/builder-ai-edit':
        'src/test-fixtures/builder-ai-edit.ts',
      '@baci/shared/test-fixtures/piggyvest-purchase':
        'src/test-fixtures/piggyvest-purchase.ts',
      '@baci/shared/test-fixtures/piggyvest-device-change':
        'src/test-fixtures/piggyvest-device-change.ts',
      '@baci/shared/test-fixtures/piggyvest-protected-offer':
        'src/test-fixtures/piggyvest-protected-offer.ts',
      '@baci/shared/test-fixtures/piggyvest-draft-closure':
        'src/test-fixtures/piggyvest-draft-closure.ts',
      '@baci/shared/test-fixtures/piggyvest-schedule':
        'src/test-fixtures/piggyvest-schedule.ts',
      '@baci/shared/test-fixtures/fixture-mock':
        'src/test-fixtures/fixture-mock.ts',
      '@baci/shared/test-fixtures/order-wallet-funding-intent':
        'src/test-fixtures/order-wallet-funding-intent.ts',
      '@baci/shared/money': 'src/money/index.ts',
    };
    for (const [specifier, target] of Object.entries(expectedTargets)) {
      const resolved = appRequire.resolve(specifier);
      expect(resolved, specifier).toBe(join(sharedPackageDir, target));
      expect(existsSync(resolved), specifier).toBe(true);
    }
    for (const specifier of subpaths) {
      const resolved = appRequire.resolve(specifier);
      expect(existsSync(resolved), specifier).toBe(true);
      expect(resolved.startsWith(join(sharedPackageDir, 'src'))).toBe(true);
    }
  });

  it('loads every fixture subpath through its exports-resolved path', async () => {
    // Load (not just resolve) each module at the path the exports map
    // produced, proving the file and its import graph load cleanly.
    for (const specifier of fixtureSubpaths) {
      const resolved = appRequire.resolve(specifier);
      const loaded = (await import(pathToFileURL(resolved).href)) as Record<
        string,
        unknown
      >;
      expect(Object.keys(loaded).length, specifier).toBeGreaterThan(0);
    }
    const schedule = (await import(
      pathToFileURL(
        appRequire.resolve('@baci/shared/test-fixtures/piggyvest-schedule')
      ).href
    )) as { scheduleJourneyFixture: () => unknown };
    expect(schedule.scheduleJourneyFixture()).toBeDefined();
    const vtu = (await import(
      pathToFileURL(appRequire.resolve('@baci/shared/vtu')).href
    )) as {
      buildPendingVtuScopeTag: unknown;
    };
    expect(typeof vtu.buildPendingVtuScopeTag).toBe('function');
  });

  it('every src domain directory with an index has a subpath export', () => {
    // 'lib' is intentionally root-consumed internal utilities.
    const allowlist = new Set(['lib', 'test-fixtures']);
    for (const entry of readdirSync(join(sharedPackageDir, 'src'))) {
      const dir = join(sharedPackageDir, 'src', entry);
      if (!statSync(dir).isDirectory()) continue;
      if (
        !(
          existsSync(join(dir, 'index.ts')) ||
          existsSync(join(dir, 'index.tsx'))
        )
      )
        continue;
      if (allowlist.has(entry)) continue;
      expect(pkg.exports, `./${entry}`).toHaveProperty(`./${entry}`);
    }
  });

  it('every exports target in package.json exists on disk', () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      expect(existsSync(join(sharedPackageDir, target)), subpath).toBe(true);
    }
  });

  it('Node-resolves every export key to its exact declared target', () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      const specifier =
        subpath === '.' ? '@baci/shared' : `@baci/shared${subpath.slice(1)}`;
      expect(appRequire.resolve(specifier), subpath).toBe(
        join(sharedPackageDir, target)
      );
    }
  });
});

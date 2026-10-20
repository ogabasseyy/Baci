import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const fixtureSubpaths = readdirSync(join(sharedPackageDir, 'src/test-fixtures'))
  .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
  .map((name) => `@baci/shared/test-fixtures/${name.replace(/\.tsx?$/, '')}`);
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

  it('resolves every new subpath through the exports map to a real file', () => {
    for (const specifier of subpaths) {
      const resolved = appRequire.resolve(specifier);
      expect(existsSync(resolved), specifier).toBe(true);
      expect(resolved.startsWith(join(sharedPackageDir, 'src'))).toBe(true);
    }
  });

  it('loads every fixture subpath through its exports-resolved path', async () => {
    // Load (not just resolve) each module at the path the exports map
    // produced, proving the file and its import graph load cleanly.
    for (const specifier of expectedSubpaths.filter((s) =>
      s.includes('/test-fixtures/')
    )) {
      const resolved = appRequire.resolve(specifier);
      const loaded = (await import(resolved)) as Record<string, unknown>;
      expect(Object.keys(loaded).length, specifier).toBeGreaterThan(0);
    }
    const schedule = (await import(
      appRequire.resolve('@baci/shared/test-fixtures/piggyvest-schedule')
    )) as { scheduleJourneyFixture: () => unknown };
    expect(schedule.scheduleJourneyFixture()).toBeDefined();
    const vtu = (await import(appRequire.resolve('@baci/shared/vtu'))) as {
      buildPendingVtuScopeTag: unknown;
    };
    expect(typeof vtu.buildPendingVtuScopeTag).toBe('function');
  });

  it('every exports target in package.json exists on disk', () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      expect(existsSync(join(sharedPackageDir, target)), subpath).toBe(true);
    }
  });
});

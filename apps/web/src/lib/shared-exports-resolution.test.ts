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
  .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
  .map((name) => `@baci/shared/test-fixtures/${name.replace(/\.ts$/, '')}`);
const subpaths = [
  ...Object.keys(pkg.exports)
    .filter((key) => key.startsWith('./test-fixtures/') || key === './vtu')
    .map((key) => `@baci/shared${key.slice(1)}`),
];

describe('@baci/shared exports resolution (no test aliases)', () => {
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

  it('every exports target in package.json exists on disk', () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      expect(existsSync(join(sharedPackageDir, target)), subpath).toBe(true);
    }
  });
});

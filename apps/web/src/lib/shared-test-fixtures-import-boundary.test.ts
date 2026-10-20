import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Import boundary: @baci/shared/test-fixtures/* is test-only surface.
// Production (non-test) source in any app — or in packages/shared
// itself — must never import it, by subpath specifier or by
// deep-relative path, even though the subpaths are resolvable
// through the package exports map.
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);
const scanRoots = [
  join(repoRoot, 'apps/web'),
  join(repoRoot, 'apps/mobile-storefront'),
  join(repoRoot, 'apps/mobile-admin'),
  join(repoRoot, 'packages/shared/src'),
];
const skippedDirs = new Set([
  'node_modules',
  '.next',
  '.expo',
  '.git',
  '.turbo',
  '.gradle',
  'build',
  'coverage',
  'DerivedData',
  'dist',
  'web-build',
  'Pods',
]);
// Limitation: this guard matches literal specifiers only. A fixture
// path assembled dynamically (string concatenation/template without a
// literal test-fixtures segment) escapes static matching and remains
// a code-review catch, not a guard catch.
const bannedPatterns = [
  // Package-specifier imports of the fixture tree.
  /['"`]@baci\/shared\/test-fixtures\//,
  // Any quoted module specifier pointing into the fixture tree or at
  // a test-support helper, whatever the callee (import, require,
  // export-from, createRequire results, dynamic import). Bare path
  // prefix constants (e.g. a staging tool's '.../test-fixtures/piggyvest-'
  // scan prefix, which does not end in a module name) are not matched.
  /['"`][^'"`]*test-fixtures\/[\w-]*(?:\w|\.(?:m|c)?[tj]sx?)['"`]/,
  /(?:from|require|import|export)\s*\(?\s*['"`][^'"`]*\.test-support/,
];

function isTestFile(path: string) {
  const normalized = path.split(sep).join('/');
  return (
    /(?:vitest|jest|metro)\.config\./.test(path) ||
    // Explicit allowlist: only the fixture definitions themselves are
    // exempt. Blanket /__tests__/ or *.test-fixtures.* exemptions are
    // deliberately NOT used — files in those locations are importable
    // from production code, so they stay scanned.
    normalized.includes('/packages/shared/src/test-fixtures/') ||
    /\.(test|spec)\.(?:m|c)?[tj]sx?$/.test(path) ||
    /\.test-support\.(?:m|c)?[tj]sx?$/.test(path) ||
    /\.test-[\w-]+\.(?:m|c)?[tj]sx?$/.test(path) ||
    /\.tests\.(?:m|c)?[tj]sx?$/.test(path)
  );
}

function collectSourceFiles() {
  // Filesystem walk over the scan roots (no git dependency, so
  // gitignored or untracked sources are scanned too). Symlinked
  // directories are not followed.
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skippedDirs.has(entry)) continue;
      const full = join(dir, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.(?:m|c)?[tj]sx?$/.test(entry) && !isTestFile(full)) {
        out.push(full);
      }
    }
  };
  for (const root of scanRoots) walk(root);
  return out;
}

describe('test-fixtures import boundary', () => {
  it('no non-test source imports shared test fixtures by any path', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles()) {
      const content = readFileSync(file, 'utf8');
      if (bannedPatterns.some((pattern) => pattern.test(content))) {
        offenders.push(file.replace(`${repoRoot}/`, ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});

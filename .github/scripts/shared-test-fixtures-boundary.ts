import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// Single source of truth for the shared test-fixtures import boundary,
// consumed by the web Vitest guard and both mobile guards (Jest and
// Vitest). Production (non-test) code must never import
// @baci/shared/test-fixtures/* — by subpath specifier, deep-relative
// path (including nested/dotted fixture paths), or through a
// test-named helper file.
//
// Semantics:
// - Fixture patterns apply to every scanned file except true test
//   files and the fixture definitions themselves. Test-named helpers
//   are NOT exempt from fixture patterns: a helper importing a shared
//   fixture is flagged, closing the transitive prod -> helper ->
//   fixture leak.
// - The test-support pattern (production importing a *.test-* helper)
//   applies only to files that are neither test files nor test-named
//   helpers, so helpers may freely import other helpers.

export const SKIPPED_DIRS = new Set([
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
  // Developer CLI tooling (apps/*/tools, scripts): executed in Node,
  // never bundled into a production app, so its imports cannot reach
  // a production bundle.
  'tools',
]);

export const FIXTURE_PATTERNS = [
  // Package-specifier imports of the fixture tree.
  /['"`]@baci\/shared\/test-fixtures\//,
  // Any quoted module specifier pointing into a test-fixtures tree,
  // including nested (`test-fixtures/piggyvest/schedule`) and dotted
  // stems, whatever the callee (import, require, export-from,
  // createRequire results, dynamic import). Bare path-prefix
  // constants that do not end in a module name are not matched.
  /['"`][^'"`]*test-fixtures\/(?:[\w.-]+\/)*[\w.-]*\w(?:\.(?:m|c)?[tj]sx?)?['"`]/,
];

export const TEST_SUPPORT_PATTERN =
  /['\"`](?:\.{1,2}\/|@baci\/|@\/|packages\/)[^'\"`]*test-(?:support|fixtures|fixture|render|utils|helpers|subject)[\w-]*(?:\.|['\"`])/;

export function normalizePath(path: string) {
  return path.split(sep).join('/');
}

export function isTestFile(path: string) {
  const normalized = normalizePath(path);
  return (
    /(?:vitest|jest|metro)\.config\./.test(normalized) ||
    // Fixture definitions themselves are exempt.
    normalized.includes('/packages/shared/src/test-fixtures/') ||
    normalized.includes('/__tests__/') ||
    /\.(test|spec)\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /\.tests\.(?:m|c)?[tj]sx?$/.test(normalized)
  );
}

export function isTestHelper(path: string) {
  const normalized = normalizePath(path);
  return (
    /\.test-support\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /[\w.-]*test-(?:support|fixtures|fixture|render|utils|helpers|subject)[\w-]*\.(?:m|c)?[tj]sx?$/.test(
      normalized
    ) ||
    // Single justified exception: test-only journey module imported
    // solely by tests/fixtures despite its production-style name.
    normalized.endsWith('/lib/piggyvest/runtime-journey-local.ts')
  );
}

export function collectSourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIPPED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.(?:m|c)?[tj]sx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  return out;
}

export function findFixtureImportOffenders(roots: string[]): string[] {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(roots)) {
    if (isTestFile(file)) continue;
    const content = readFileSync(file, 'utf8');
    if (FIXTURE_PATTERNS.some((pattern) => pattern.test(content))) {
      offenders.push(file);
      continue;
    }
    if (!isTestHelper(file) && TEST_SUPPORT_PATTERN.test(content)) {
      offenders.push(file);
    }
  }
  return offenders;
}

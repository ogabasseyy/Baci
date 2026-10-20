import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// Import boundary (per-app mirror of the web guard): production
// (non-test) sources in this app must never import
// @baci/shared/test-fixtures/* by a literal subpath or deep-relative
// specifier. Like the web guard, this matches literal specifiers
// only; dynamically assembled paths are a code-review catch.
// This suite runs in this app's own CI, so a mobile-only PR cannot
// slip a fixture import past the web-only guard.
// __dirname is provided by both Jest (CJS) and Vitest (node env);
// import.meta cannot be used here because Jest parses this file as CJS.
const appRoot = join(__dirname, '..');
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
const bannedPatterns = [
  // Package-specifier imports of the fixture tree.
  /['"`]@baci\/shared\/test-fixtures\//,
  // Any quoted module specifier pointing into the fixture tree or at
  // a test-support helper, whatever the callee (import, require,
  // export-from, createRequire results, dynamic import). Bare path
  // prefix constants (e.g. a staging tool's '.../test-fixtures/piggyvest-'
  // scan prefix, which does not end in a module name) are not matched.
  /['"`][^'"`]*test-fixtures\/[\w-]*(?:\w|\.(?:m|c)?[tj]sx?)['"`]/,
  /['"`](?:\.{1,2}\/|@baci\/|@\/|packages\/)[^'"`]*\.test-[\w-]*/,
];

function normalize(path: string) {
  return path.split(sep).join('/');
}

function isTestFile(path: string) {
  const normalized = normalize(path);
  return (
    /(?:vitest|jest|metro)\.config\./.test(normalized) ||
    // Fixture definitions themselves are exempt.
    normalized.includes('/packages/shared/src/test-fixtures/') ||
    // Test files and closed test-helper filename/location conventions
    // (not a generic *.test-* exemption): production files importing
    // ANY *.test-* helper are flagged by the banned patterns below.
    normalized.includes('/__tests__/') ||
    /\.(test|spec)\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /\.test-support\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /[\w.-]*test-(?:support|fixtures|fixture|render|utils|helpers|subject)[\w-]*\.(?:m|c)?[tj]sx?$/.test(
      normalized
    ) ||
    /\.tests\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    // Single justified exception: test-only journey module imported
    // solely by tests/fixtures despite its production-style name.
    normalized.endsWith('/lib/piggyvest/runtime-journey-local.ts')
  );
}
function collect(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      collect(full, out);
    } else if (/\.(?:m|c)?[tj]sx?$/.test(entry) && !isTestFile(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('shared test-fixtures import boundary', () => {
  it('no non-test source imports @baci/shared/test-fixtures', () => {
    // This app's sources plus packages/shared/src (so a shared-source
    // change in a mobile-only PR is guarded here, not only by web).
    const sharedSrc = join(appRoot, '..', '..', 'packages', 'shared', 'src');
    const offenders = collect(appRoot, [])
      .concat(collect(sharedSrc, []))
      .filter((file) =>
        bannedPatterns.some((pattern) =>
          pattern.test(readFileSync(file, 'utf8'))
        )
      );
    expect(offenders).toEqual([]);
  });
});

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

describe('boundary guard pattern parity', () => {
  function extractBannedPatterns(content: string): string[] {
    const start = content.indexOf('const bannedPatterns = [');
    const slice = content.slice(start, content.indexOf('];', start));
    return slice
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('/') && line.endsWith(','))
      .map((line) => line.slice(0, -1))
      .sort();
  }

  function extractSkippedDirs(content: string): string[] {
    const start = content.indexOf('skippedDirs = new Set([');
    const slice = content.slice(start, content.indexOf(']);', start));
    return [...slice.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  }

  function extractIsTestFile(content: string): string {
    const start = content.indexOf('function isTestFile');
    const slice = content.slice(start, content.indexOf('\n}\n', start));
    return slice.replace(/\s+/g, ' ').trim();
  }

  it('mobile mirrors use identical guard semantics', () => {
    const ownPath = join(
      repoRoot,
      'apps/web/src/lib/shared-test-fixtures-import-boundary.test.ts'
    );
    const own = readFileSync(ownPath, 'utf8');
    for (const mirror of [
      'apps/mobile-storefront/lib/shared-test-fixtures-boundary.test.ts',
      'apps/mobile-admin/lib/shared-test-fixtures-boundary.test.ts',
    ]) {
      const theirs = readFileSync(join(repoRoot, mirror), 'utf8');
      expect(extractBannedPatterns(theirs), mirror).toEqual(
        extractBannedPatterns(own)
      );
      expect(extractSkippedDirs(theirs), mirror).toEqual(
        extractSkippedDirs(own)
      );
      expect(extractIsTestFile(theirs), mirror).toBe(extractIsTestFile(own));
    }
  });
});

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

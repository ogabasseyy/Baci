import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const bannedPatterns = [
  // Package-specifier imports of the fixture tree.
  /['"`]@baci\/shared\/test-fixtures\//,
  // Deep-relative fixture paths in import/require/export position
  // (a bare string mentioning the tree, e.g. a staging tool's path
  // prefix constant, is not an import and is not matched).
  /(?:from|require|import)\s*\(?\s*['"`][^'"`]*test-fixtures\//,
  /packages\/shared\/src\/lib\/[^'"]*\.test-support/,
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
    /\.tests\.(?:m|c)?[tj]sx?$/.test(path)
  );
}

function collectSourceFiles() {
  // Git-tracked files only: fast, and immune to local build artifacts.
  const listed = execSync('git ls-files', {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .split('\n')
    .filter(Boolean)
    .map((relative) => join(repoRoot, relative))
    .filter((file) => scanRoots.some((root) => file.startsWith(root + sep)))
    .filter((file) => !file.split(sep).some((part) => skippedDirs.has(part)))
    .filter((file) => /\.(?:m|c)?[tj]sx?$/.test(file))
    .filter((file) => !isTestFile(file));
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

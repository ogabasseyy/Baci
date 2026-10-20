import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Import boundary: @baci/shared/test-fixtures/* is test-only surface.
// Production (non-test) source in any app — or in packages/shared
// itself — must never import it, by subpath specifier or by
// deep-relative path, even though the subpaths are resolvable
// through the package exports map.
const repoRoot = dirname(fileURLToPath(import.meta.url)).replace(
  /\/apps\/web\/src\/lib$/,
  ''
);
const scanRoots = [
  join(repoRoot, 'apps/web/src'),
  join(repoRoot, 'apps/mobile-storefront'),
  join(repoRoot, 'apps/mobile-admin'),
  join(repoRoot, 'packages/shared/src'),
];
const skippedDirs = new Set([
  'node_modules',
  '.next',
  '.expo',
  '.git',
  'build',
  'Pods',
]);
const bannedPatterns = [
  /@baci\/shared\/test-fixtures\//,
  /packages\/shared\/src\/test-fixtures\//,
  /packages\/shared\/src\/lib\/[^'"]*\.test-support/,
  /from\s+['"](?:\.{1,2}\/)+test-fixtures\//,
  /import\(\s*['"](?:\.{1,2}\/)+test-fixtures\//,
];

function isTestFile(path: string) {
  return (
    /(?:vitest|jest|metro)\.config\./.test(path) ||
    path.includes('/__tests__/') ||
    path.includes('/test-fixtures/') ||
    /\.(test|spec)\.(?:m|c)?[tj]sx?$/.test(path) ||
    /\.test-support\.(?:m|c)?[tj]s$/.test(path)
  );
}

function collectSourceFiles(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(?:m|c)?[tj]sx?$/.test(entry) && !isTestFile(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('test-fixtures import boundary', () => {
  it('no non-test source imports shared test fixtures by any path', () => {
    const offenders: string[] = [];
    for (const root of scanRoots) {
      for (const file of collectSourceFiles(root, [])) {
        const content = readFileSync(file, 'utf8');
        if (bannedPatterns.some((pattern) => pattern.test(content))) {
          offenders.push(file.replace(`${repoRoot}/`, ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

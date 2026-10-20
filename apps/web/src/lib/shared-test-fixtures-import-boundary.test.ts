import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Import boundary: @baci/shared/test-fixtures/* is test-only surface.
// Production (non-test) source in any app must never import it, even
// though the subpaths are resolvable through the package exports map.
const repoRoot = resolve(process.cwd(), '../..');
const appRoots = [
  join(repoRoot, 'apps/web/src'),
  join(repoRoot, 'apps/mobile-storefront'),
  join(repoRoot, 'apps/mobile-admin'),
];
const fixtureImportPattern = /@baci\/shared\/test-fixtures\//;

function isTestFile(path: string) {
  return (
    path.includes('/__tests__/') ||
    /\.(test|spec)\.[tj]sx?$/.test(path) ||
    /\.test-support\.[tj]s$/.test(path)
  );
}

function collectSourceFiles(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.[tj]sx?$/.test(entry) && !isTestFile(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('test-fixtures import boundary', () => {
  it('no non-test app source imports @baci/shared/test-fixtures', () => {
    const offenders: string[] = [];
    for (const root of appRoots) {
      for (const file of collectSourceFiles(root, [])) {
        if (fixtureImportPattern.test(readFileSync(file, 'utf8'))) {
          offenders.push(file.replace(`${repoRoot}/`, ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

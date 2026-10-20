import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// Import boundary (per-app mirror of the web guard): production
// (non-test) sources in this app must never import
// @baci/shared/test-fixtures/*, by subpath or deep-relative path.
// This suite runs in this app's own CI, so a mobile-only PR cannot
// slip a fixture import past the web-only guard.
const appRoot = process.cwd();
const skippedDirs = new Set([
  'node_modules',
  '.expo',
  'build',
  'dist',
  'web-build',
  'Pods',
]);
const bannedPatterns = [
  /['"`]@baci\/shared\/test-fixtures\//,
  /(?:from|require|import)\s*\(?\s*['"`][^'"`]*test-fixtures\//,
];

function normalize(path: string) {
  return path.split(sep).join('/');
}

function isTestFile(path: string) {
  const normalized = normalize(path);
  return (
    /(?:vitest|jest|metro)\.config\./.test(normalized) ||
    /\.(test|spec)\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /\.tests\.(?:m|c)?[tj]sx?$/.test(normalized)
  );
}

function collect(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (/\.(?:m|c)?[tj]sx?$/.test(entry) && !isTestFile(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('shared test-fixtures import boundary', () => {
  it('no non-test source imports @baci/shared/test-fixtures', () => {
    const offenders = collect(appRoot, []).filter((file) =>
      bannedPatterns.some((pattern) => pattern.test(readFileSync(file, 'utf8')))
    );
    expect(offenders).toEqual([]);
  });
});

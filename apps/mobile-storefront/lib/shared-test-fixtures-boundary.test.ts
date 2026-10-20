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
  /['"`]@baci\/shared\/test-fixtures\//,
  /(?:from|require|import)\s*\(?\s*['"`][^'"`]*test-fixtures\//,
  /packages\/shared\/src\/lib\/[^'"]*\.test-support/,
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
    const offenders = collect(appRoot, []).filter((file) =>
      bannedPatterns.some((pattern) => pattern.test(readFileSync(file, 'utf8')))
    );
    expect(offenders).toEqual([]);
  });
});

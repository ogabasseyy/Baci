import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every enable flag must be read through isPiggyvestFeatureOn so the master
// kill switch cannot be bypassed. The scan is recursive over the whole web
// source tree and scripts, and it also rejects flag names built at runtime.
const webRoot = join(__dirname, '..', '..', '..');
const roots = [join(webRoot, 'src'), join(webRoot, 'scripts')];
const registry = 'src/lib/piggyvest/piggyvest-feature-flags.ts';
const sourceFile = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const testFile = /\.(?:test|spec)\.|\.test-|\.test\.|__tests__/;

function walk(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  } catch {
    return [];
  }
}

const sources = roots
  .flatMap(walk)
  .filter((path) => sourceFile.test(path) && !testFile.test(path))
  .map((path) => ({
    path: relative(webRoot, path),
    text: readFileSync(path, 'utf8'),
  }));

// A read is property or bracket access on any env-like object. Declaring a
// name (a schema key or a readiness list) is not a read and is allowed.
const directRead =
  /\benv\w*\s*(?:\??\.|\??\.?\[\s*['"`])\s*PIGGYVEST_\w*_ENABLED/i;
const destructured = /\{[^}]*\bPIGGYVEST_\w*_ENABLED\b[^}]*\}\s*=\s*\w*env/i;
const templateBuilt = /PIGGYVEST_\w*\$\{/;
const suffixBuilt = /['"`](?!PIGGYVEST_)\w*_ENABLED['"`]/;
// Pre-existing staging-only draft gate: hardcoded staging merchant, staging
// Supabase URL required, and no wallet or money movement. Not a new-money path.
const allowed = new Set([
  registry,
  'src/lib/customer-savings-draft-request.ts',
]);

describe('no direct reads of PiggyVest enable flags', () => {
  it('scans a meaningful number of files', () => {
    expect(sources.length).toBeGreaterThan(100);
  });
  it('no module reads an enable flag directly', () => {
    const offenders = sources
      .filter(
        (file) =>
          !allowed.has(file.path) &&
          (directRead.test(file.text) || destructured.test(file.text))
      )
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
  it('no module builds a PIGGYVEST_ name or an _ENABLED suffix at runtime', () => {
    const offenders = sources
      .filter(
        (file) =>
          !allowed.has(file.path) &&
          (templateBuilt.test(file.text) ||
            (file.text.includes('PIGGYVEST_') && suffixBuilt.test(file.text)))
      )
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every enable flag must be read through isPiggyvestFeatureOn so the master
// kill switch cannot be bypassed. The scan is recursive over the whole web
// source tree and scripts, and it also rejects flag names built at runtime.
const webRoot = join(__dirname, '..', '..', '..');
const repoRoot = join(webRoot, '..', '..');
// Launch tooling that materializes an environment for a child process lives
// under the repo tools tree, so it is scanned with the web source.
const roots = [
  join(webRoot, 'src'),
  join(webRoot, 'scripts'),
  join(repoRoot, 'tools'),
];
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

// A read is property or bracket access of an enable-flag name on ANY object,
// so aliases (const e = process.env), parameters (input.PIGGYVEST_X_ENABLED)
// and renamed env objects are all covered. Declaring a name (a schema key or a
// readiness list) is not a read and is allowed.
const flagName = String.raw`(?:PIGGYVEST|PREFUNDED_CARD)_\w*_ENABLED`;
const directRead = new RegExp(
  String.raw`(?:\??\.|[\w)\]]\s*\??\.?\[\s*['"\`])\s*${flagName}\b`
);
// Destructuring a flag from any right-hand side, aliased or not.
const destructured = new RegExp(
  String.raw`\{[^}]*\b${flagName}\b[^}]*\}\s*=[^=>]`
);
// A bare alias of the whole environment can hide later reads.
const envAlias = /\b(?:const|let|var)\s+\w+\s*=\s*process\.env\s*;/;
// Enable flags outside the PIGGYVEST_ namespace are registered too, so inside
// the piggyvest library any *_ENABLED property read is direct.
const anyEnabledRead =
  /(?:\??\.|[\w)\]]\s*\??\.?\[\s*['"`])\s*[A-Z][A-Z0-9_]*_ENABLED\b/;
// The registry object may be referenced only by the registry and the helper,
// so env[PIGGYVEST_FEATURE_FLAGS.x] (or an alias of it) cannot read a flag.
const registryObject = /\bPIGGYVEST_FEATURE_FLAGS\b/;
const piggyvestLib = 'src/lib/piggyvest/';
const templateBuilt = /PIGGYVEST_\w*\$\{/;
const suffixBuilt = /['"`](?!PIGGYVEST_)\w*_ENABLED['"`]/;
// Pre-existing staging-only draft gate: hardcoded staging merchant, staging
// Supabase URL required, and no wallet or money movement. Not a new-money path.
const allowed = new Set([
  registry,
  'src/lib/piggyvest/piggyvest-feature-on.ts',
  'src/lib/customer-savings-draft-request.ts',
  // Restriction only: refuses a profile that carries the flag; enables nothing.
  'src/lib/hosted-savings-environment.ts',
  // Re-emits the already validated value, it does not gate anything.
  'src/schemas/hosted-first-card-environment.ts',
  // Owner launcher: forwards the flag into the child environment through
  // createFirstCardLaunchEnvironment, which forces mutations off and copies
  // the kill switch when the parent is killed (covered by its own test).
  '../../tools/staging/prefunded-card/launch-public.ts',
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
          (directRead.test(file.text) ||
            destructured.test(file.text) ||
            envAlias.test(file.text) ||
            registryObject.test(file.text) ||
            (file.path.startsWith(piggyvestLib) &&
              anyEnabledRead.test(file.text)))
      )
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
  it('flags renamed, aliased and destructured reads', () => {
    for (const read of [
      'const { PIGGYVEST_PRIMARY_ENABLED } = process.env;',
      'const { PIGGYVEST_PRIMARY_ENABLED: on } = input;',
      'const e = process.env;',
      "e.PIGGYVEST_PRIMARY_ENABLED === 'true'",
      'input.PIGGYVEST_PRIMARY_CARD_ENABLED',
      'options?.PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED',
      "settings['PIGGYVEST_PRIMARY_INFLOWS_ENABLED']",
    ]) {
      expect(
        directRead.test(read) || destructured.test(read) || envAlias.test(read),
        read
      ).toBe(true);
    }
  });
  it('does not flag declarations or unrelated env use', () => {
    for (const text of [
      "const names = ['PIGGYVEST_PRIMARY_ENABLED'];",
      'PIGGYVEST_PRIMARY_ENABLED: z.literal(true),',
      'const { PIGGYVEST_PRIMARY_DB_HOST } = process.env;',
      'const value = process.env.PIGGYVEST_PRIMARY_DB_HOST;',
      'envs = process.environment;',
    ]) {
      expect(
        directRead.test(text) || destructured.test(text) || envAlias.test(text),
        text
      ).toBe(false);
    }
  });
  it('detects each read pattern the scan relies on', () => {
    expect(registryObject.test('env[PIGGYVEST_FEATURE_FLAGS.bank_inbox]')).toBe(
      true
    );
    expect(
      anyEnabledRead.test('environment.PREFUNDED_CARD_PUBLIC_ENABLED')
    ).toBe(true);
    expect(anyEnabledRead.test("process.env['X_ENABLED']")).toBe(true);
    expect(registryObject.test('env.PIGGYVEST_PRIMARY_DB_HOST')).toBe(false);
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

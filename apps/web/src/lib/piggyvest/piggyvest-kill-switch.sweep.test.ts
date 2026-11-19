import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES } from '@/schemas/piggyvest-primary-wallet-capability';

// Every enable flag must be read through isPiggyvestFeatureOn so the master
// kill switch cannot be bypassed. The scan is recursive over the whole web
// source tree and scripts, and it also rejects flag names built at runtime.
// This sweep is an early warning, not the guarantee: the runtime gate and the
// behaviour tests run with PIGGYVEST_KILL_SWITCH=true are the real protection.
// Accepted limitation: further regex-shape evasions (aliases, env objects held
// under other names), trees outside the roots below and non-JavaScript tooling
// (for example Python activation bundles) are not detected here.
const webRoot = join(__dirname, '..', '..', '..');
const repoRoot = join(webRoot, '..', '..');
// Launch tooling that materializes an environment for a child process lives
// under the repo tools tree, so it is scanned with the web source.
const roots = [
  { name: 'web src', dir: join(webRoot, 'src'), minimum: 500 },
  { name: 'web tools', dir: join(webRoot, 'tools'), minimum: 50 },
  { name: 'repo scripts', dir: join(repoRoot, 'scripts'), minimum: 5 },
  { name: 'repo tools', dir: join(repoRoot, 'tools'), minimum: 20 },
];
const registry = 'src/lib/piggyvest/piggyvest-feature-flags.ts';
const sourceFile = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// Only recognised test files and fixtures are excluded: a test suffix directly
// before the extension, a named test-support/fixture/helper suffix, or a
// __tests__ directory. A name that merely contains ".test-" is still scanned.
const testFile =
  /\.(?:test|spec)(?:\.[\w-]+)?\.[mc]?[jt]sx?$|\.test-(?:support|fixture|helpers?)(?:\.test)?\.[mc]?[jt]sx?$|(?:^|[\\/])__tests__[\\/]/;

// Unlike a silent fallback, a missing or unreadable root fails the suite.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const scanned = roots.map((root) => ({
  ...root,
  files: walk(root.dir).filter(
    (path) => sourceFile.test(path) && !testFile.test(path)
  ),
}));
const sources = scanned
  .flatMap((root) => root.files)
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
  String.raw`(?:\??\.|[\w)\]]\s*\??\.?\[\s*['"\`])${flagName}\b`
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
  /(?:\??\.|[\w)\]]\s*\??\.?\[\s*['"`])[A-Z][A-Z0-9_]*_ENABLED\b/;
// The registry object may be referenced only by the registry and the helper,
// so env[PIGGYVEST_FEATURE_FLAGS.x] (or an alias of it) cannot read a flag.
const registryObject = /\bPIGGYVEST_FEATURE_FLAGS\b/;
// Reflective and computed-name reads that never spell the flag name at the
// access site: Reflect.get(env, name), Object.entries/values/fromEntries(env)
// and env[someVariable] or env[`${PREFIX}${name}`] inside the PiggyVest library.
const reflectiveRead =
  /\bReflect\.(?:get|has|ownKeys)\(|\bObject\.(?:entries|values|fromEntries)\(\s*(?:process\.)?env(?:ironment)?\b/;
const computedEnvRead =
  /\benv(?:ironment)?\s*\??\.?\[\s*(?:`[^`]*\$\{|[A-Za-z_$])/;
const piggyvestLib = 'src/lib/piggyvest/';
const flagFamily = /\b(?:PIGGYVEST|PREFUNDED_CARD)_/;
const templateBuilt = /PIGGYVEST_\w*\$\{/;
const suffixBuilt = /['"`](?!PIGGYVEST_)\w*_ENABLED['"`]/;
function buildsEnableFlag(text: string): boolean {
  if (!text.includes('PIGGYVEST_')) return false;
  // Syntax-aware leaf tokens exclude comments without treating slash pairs
  // inside a regular-expression literal as comment delimiters.
  const sourceFile = ts.createSourceFile(
    'kill-switch-scan.ts',
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const tokens: string[] = [];
  const collectTokens = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JSDocComment) return;
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      tokens.push(node.getText(sourceFile));
      return;
    }
    for (const child of children) collectTokens(child);
  };
  collectTokens(sourceFile);
  const executable = tokens.join(' ');
  return (
    templateBuilt.test(executable) ||
    (executable.includes('PIGGYVEST_') && suffixBuilt.test(executable))
  );
}
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
  // createFirstCardLaunchEnvironment, which copies the kill switch into the
  // child (covered by its own test).
  '../../tools/staging/prefunded-card/launch-public.ts',
  // Reads one unrelated attestation variable through a constant; not a flag.
  'src/lib/piggyvest/webhook-capture-attestation.ts',
  // Reads the two minimum-client-build numbers, not enable flags; asserted
  // below so a flag name can never be added to that variable map.
  'src/lib/piggyvest/primary-client-build-floors.ts',
  // Reads its own non-enable settings through a prefix helper; the enable flag
  // goes through isPiggyvestFeatureOn (asserted below).
  'src/lib/piggyvest/customer-plan-funding-runtime.ts',
]);
const unsafeCode = (file: { path: string; text: string }) =>
  directRead.test(file.text) ||
  destructured.test(file.text) ||
  envAlias.test(file.text) ||
  registryObject.test(file.text) ||
  (file.path.startsWith(piggyvestLib) &&
    (anyEnabledRead.test(file.text) || computedEnvRead.test(file.text))) ||
  // Reflective reads matter wherever the file knows a PiggyVest flag family.
  ((file.path.startsWith(piggyvestLib) || flagFamily.test(file.text)) &&
    reflectiveRead.test(file.text));

describe('no direct reads of PiggyVest enable flags', () => {
  it.each(
    scanned.map((root) => [root.name, root] as const)
  )('scans the %s root and its file count has not shrunk', (_name, root) => {
    expect(root.files.length).toBeGreaterThanOrEqual(root.minimum);
  });
  it('excludes only recognised test files', () => {
    for (const name of [
      'a.test.ts',
      'a.spec.tsx',
      'a.test-support.ts',
      'a.test-fixture.ts',
      'a.test-support.test.ts',
      'x/__tests__/a.ts',
    ])
      expect(testFile.test(name), name).toBe(true);
    for (const name of ['latest-flag.test-reader.ts', 'a.ts', 'attest.tsx'])
      expect(testFile.test(name), name).toBe(false);
  });
  it('the build-floor variable names are not enable flags', () => {
    for (const name of Object.values(
      PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES
    ))
      expect(name).not.toMatch(/ENABLED/);
  });
  it('the plan-funding helper never reads an enable flag', () => {
    const file = sources.find(
      (f) => f.path === 'src/lib/piggyvest/customer-plan-funding-runtime.ts'
    );
    expect(file?.text).toBeDefined();
    expect(file?.text).not.toMatch(/read\(\s*['"][^'"]*ENABLED/);
    expect(file?.text).toContain("isPiggyvestFeatureOn('plan_funding'");
  });
  // DOCUMENTED EXCEPTION to "gate through isPiggyvestFeatureOn": the daily
  // reconciliation only reads (never moves money) and exists to surface stuck
  // transfers, so the master kill switch must not silence it. It uses the
  // flag-only reader on purpose; no other module may follow it silently.
  it('only the read-only daily reconciliation gates on the flag alone', () => {
    const readOnlyReport = 'src/lib/piggyvest/daily-reconciliation-runtime.ts';
    const file = sources.find((f) => f.path === readOnlyReport);
    expect(file?.text).toContain(
      "isPiggyvestFeatureFlagSet('daily_reconciliation'"
    );
    expect(file?.text).not.toMatch(/isPiggyvestFeatureOn\(/);
    const flagOnlyReaders = sources
      .filter((f) =>
        /\bisPiggyvestFeatureFlagSet\(\s*['"]daily_reconciliation/.test(f.text)
      )
      .map((f) => f.path);
    expect(flagOnlyReaders).toEqual([readOnlyReport]);
  });
  it('no module reads an enable flag directly', () => {
    const offenders = sources
      .filter((file) => !allowed.has(file.path) && unsafeCode(file))
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
  it('flags reflective and computed-name reads', () => {
    for (const read of [
      "Reflect.get(env, 'PIGGYVEST_PRIMARY_ENABLED')",
      "Object.entries(env).find(([k]) => k.endsWith('_ENABLED'))",
      'Object.values(process.env)',
      'const on = env[name];',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture text, not a template
      'env[`${PREFIX}${name}`]',
      'environment?.[flag]',
    ])
      expect(
        reflectiveRead.test(read) || computedEnvRead.test(read),
        read
      ).toBe(true);
  });
  it('does not flag literal or unrelated computed access', () => {
    for (const text of [
      "env['PIGGYVEST_PRIMARY_DB_HOST']",
      'Object.keys(process.env)',
      'process.environment',
      'const values = Object.values(options);',
    ])
      expect(
        reflectiveRead.test(text) || computedEnvRead.test(text),
        text
      ).toBe(false);
  });
  it('does not flag declarations or unrelated env use', () => {
    for (const text of [
      '// refresh stays available.\n  PREFUNDED_CARD_PUBLIC_ENABLED: x',
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
  it('distinguishes diagnostic strings from constructed enable-flag suffixes', () => {
    for (const comment of [
      '// PIGGYVEST_EXAMPLE_ENABLED\n',
      '/* PIGGYVEST_EXAMPLE_ENABLED */',
    ])
      expect(buildsEnableFlag(`${comment}return 'DRAIN_NOT_ENABLED';`)).toBe(
        false
      );
    for (const source of [
      "const suffix = '_ENABLED';",
      "const flag = prefix + 'BANK_ENABLED';",
      "const flag = 'BANK_ENABLED' + suffix;",
      "const flag = prefix.concat('BANK_ENABLED');",
      "const suffix = 'BANK_ENABLED'; const flag = prefix + suffix;",
    ])
      expect(
        buildsEnableFlag(`const prefix = 'PIGGYVEST_'; ${source}`),
        source
      ).toBe(true);
    expect(
      buildsEnableFlag(
        "const re = /[/*]/; const prefix = 'PIGGYVEST_'; const flag = prefix + '_ENABLED';"
      )
    ).toBe(true);
  });
  it('no module builds a PIGGYVEST_ name or an _ENABLED suffix at runtime', () => {
    const offenders = sources
      .filter((file) => !allowed.has(file.path) && buildsEnableFlag(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const { loadEnvConfig, resetEnv } = nextEnv;
const SCRIPT = fileURLToPath(
  new URL('./inject-prebuilt-env-secret.mjs', import.meta.url),
);
const DEPLOY_WORKFLOW = fileURLToPath(new URL('../workflows/deploy.yml', import.meta.url));
const JWK_KEY = 'SUPABASE_AGENTIC_JWT_PRIVATE_JWK';
const LEGACY_JWT_KEY = 'SUPABASE_JWT_SECRET';
const GENERATE_ES256_JWK_STANDIN = '--generate-es256-jwk-standin';
const GENERATED_ES256_JWK_STANDIN_KID = 'baci-build-only-es256-jwk-standin';

function makeEnvFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-jwk-env-'));
  const file = path.join(dir, '.env.production.local');
  fs.writeFileSync(file, contents);
  return file;
}

function makePulledJwkEnvFile(value = '""') {
  return makeEnvFile(
    [
      'AI_CHAT_MODEL="cerebras"',
      `${JWK_KEY}=${value}`,
      'QUIZ_PHASE="production"',
      '',
    ].join('\n'),
  );
}

function run(args, env = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, [JWK_KEY]: '', ...env },
    encoding: 'utf8',
  });
}

function runExpectFailure(args, env = {}) {
  try {
    run(args, env);
    throw new Error('expected non-zero exit');
  } catch (err) {
    if (err.status === undefined) throw err;
    return { status: err.status, stderr: String(err.stderr ?? '') };
  }
}

function parseSingleQuotedValue(file, key) {
  const line = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(`${key}=`));
  assert.ok(line);
  assert.match(line, new RegExp(`^${key}='.*'$`));
  return line.slice(`${key}='`.length, -1);
}

function assertGeneratedEs256PrivateJwk(serializedJwk) {
  const jwk = JSON.parse(serializedJwk);
  assert.equal(jwk.alg, 'ES256');
  assert.equal(jwk.crv, 'P-256');
  assert.equal(jwk.kid, GENERATED_ES256_JWK_STANDIN_KID);
  assert.equal(jwk.kty, 'EC');
  for (const field of ['d', 'x', 'y']) {
    assert.match(jwk[field], /^[A-Za-z0-9_-]+$/);
  }
  assert.doesNotThrow(() => createPrivateKey({ key: jwk, format: 'jwk' }));
}

test('generated JWK stand-in refuses a nonblank pulled value', () => {
  const file = makePulledJwkEnvFile('"opaque-pulled-value"');
  const before = fs.readFileSync(file, 'utf8');
  const { status, stderr } = runExpectFailure([
    JWK_KEY,
    file,
    GENERATE_ES256_JWK_STANDIN,
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /explicitly blank|opaque|nonblank/i);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('generated JWK stand-in preserves a verified legacy signing-secret fallback', () => {
  const file = makeEnvFile(
    [
      'AI_CHAT_MODEL="cerebras"',
      `${LEGACY_JWT_KEY}="legacy-build-value"`,
      'QUIZ_PHASE="production"',
      '',
    ].join('\n'),
  );
  const before = fs.readFileSync(file, 'utf8');
  const stdout = run([JWK_KEY, file, GENERATE_ES256_JWK_STANDIN]);

  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.match(stdout, /absent.*verified.*legacy signing-secret fallback/i);
});

for (const [state, contents] of [
  ['absent', 'AI_CHAT_MODEL="cerebras"\n'],
  ['empty', `${LEGACY_JWT_KEY}=""\n`],
  ['ambiguous', `${LEGACY_JWT_KEY}=first\n${LEGACY_JWT_KEY}=second\n`],
]) {
  test(`generated JWK stand-in fails closed when the legacy fallback is ${state}`, () => {
    const file = makeEnvFile(contents);
    const before = fs.readFileSync(file, 'utf8');
    const { status, stderr } = runExpectFailure([
      JWK_KEY,
      file,
      GENERATE_ES256_JWK_STANDIN,
    ]);

    assert.equal(status, 1);
    assert.match(stderr, new RegExp(`fallback is ${state}.*without signing material`, 'i'));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
}

for (const [description, value, state] of [
  ['whitespace', '"   "', 'empty'],
  ['an unset expansion', '"${UNSET_SIGNING_SECRET}"', 'an unresolved interpolation'],
]) {
  test(`generated JWK stand-in rejects ${description} as an empty legacy fallback`, () => {
    const file = makeEnvFile(`${LEGACY_JWT_KEY}=${value}\n`);
    const before = fs.readFileSync(file, 'utf8');
    const { status, stderr } = runExpectFailure([
      JWK_KEY,
      file,
      GENERATE_ES256_JWK_STANDIN,
    ]);

    assert.equal(status, 1);
    assert.match(
      stderr,
      new RegExp(`fallback is ${state}.*without signing material`, 'i'),
    );
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
}

test('generated JWK stand-in rejects a nonempty fallback with an unresolved reference', () => {
  const file = makeEnvFile(
    `${LEGACY_JWT_KEY}="prefix-$BACI_TEST_MISSING_SIGNING_SECRET"\n`,
  );
  const before = fs.readFileSync(file, 'utf8');
  const { status, stderr } = runExpectFailure([
    JWK_KEY,
    file,
    GENERATE_ES256_JWK_STANDIN,
  ]);

  assert.equal(status, 1);
  assert.match(stderr, /fallback is an unresolved interpolation/i);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('generated JWK stand-in accepts a fully resolved nonempty fallback', () => {
  const file = makeEnvFile(
    `JWT_PREFIX=legacy\n${LEGACY_JWT_KEY}="$JWT_PREFIX-signing-value"\n`,
  );
  const before = fs.readFileSync(file, 'utf8');
  const stdout = run([JWK_KEY, file, GENERATE_ES256_JWK_STANDIN]);

  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.match(stdout, /verified.*legacy signing-secret fallback/i);
});

test('generated JWK stand-in accepts explicit blanks and the CLI sensitive marker', () => {
  const generatedValues = [];

  for (const blankValue of ['', "''", '""', '"[SENSITIVE]"']) {
    const file = makePulledJwkEnvFile(blankValue);
    const stdout = run([JWK_KEY, file, GENERATE_ES256_JWK_STANDIN]);
    const generatedValue = parseSingleQuotedValue(file, JWK_KEY);
    assertGeneratedEs256PrivateJwk(generatedValue);
    assert.equal(stdout.includes(generatedValue), false);
    generatedValues.push(generatedValue);
  }

  assert.notEqual(generatedValues[0], generatedValues[1]);
});

test('writes a generated JWK that @next/env reads unchanged for build validation', () => {
  const file = makePulledJwkEnvFile();
  const originalValue = process.env[JWK_KEY];

  try {
    run([JWK_KEY, file, GENERATE_ES256_JWK_STANDIN]);
    const generatedValue = parseSingleQuotedValue(file, JWK_KEY);
    delete process.env[JWK_KEY];
    loadEnvConfig(path.dirname(file), false, console, true);
    assert.equal(process.env[JWK_KEY], generatedValue);
    assertGeneratedEs256PrivateJwk(process.env[JWK_KEY]);
  } finally {
    resetEnv();
    if (originalValue === undefined) delete process.env[JWK_KEY];
    else process.env[JWK_KEY] = originalValue;
  }
});

test('configured process value wins over an opaque pulled JWK and is not logged', () => {
  const file = makePulledJwkEnvFile('"opaque-pulled-value"');
  const runtimeValue = JSON.stringify({ kid: 'runtime-owned-kid', source: 'vercel-runtime' });
  const runtimeOutput = run([JWK_KEY, file, GENERATE_ES256_JWK_STANDIN], {
    [JWK_KEY]: runtimeValue,
  });
  assert.equal(parseSingleQuotedValue(file, JWK_KEY), runtimeValue);
  assert.equal(runtimeOutput.includes(runtimeValue), false);
  assert.doesNotMatch(runtimeOutput, /generated ES256 build-time stand-in/);
});

test('workflow generates the JWK internally and keeps runtime injection Vercel-owned', () => {
  const workflow = fs.readFileSync(DEPLOY_WORKFLOW, 'utf8');
  const stepStart = workflow.indexOf(
    '      - name: Ensure build-time presence of runtime-only scoped Supabase JWT key',
  );
  const buildStart = workflow.indexOf('      - name: Build for Vercel', stepStart);
  assert.ok(stepStart >= 0);
  assert.ok(buildStart > stepStart);

  const step = workflow.slice(stepStart, buildStart);
  assert.match(step, new RegExp(GENERATE_ES256_JWK_STANDIN));
  assert.doesNotMatch(step, /public Supabase documentation example/);
  assert.doesNotMatch(step, /"d"\s*:/);
  assert.doesNotMatch(step, /"kty"\s*:\s*"EC"/);
  assert.doesNotMatch(step, /^\s+env:/m);
  assert.doesNotMatch(step, /\$\{\{\s*secrets\./);
});

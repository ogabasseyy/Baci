import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./android-benchmark.mjs', import.meta.url).pathname;
const required = ['STOREFRONT_FACEBOOK_APP_ID', 'STOREFRONT_FACEBOOK_CLIENT_TOKEN', 'EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const fixture = Object.fromEntries(required.map((key) => [key, `synthetic-${key}`]));
function run(path, env = {}) {
  const clean = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  return spawnSync(process.execPath, [script, '--check', '--env-file', path], { encoding: 'utf8', env: clean });
}
function withFile(content, action) {
  const dir = mkdtempSync(join(tmpdir(), 'baci-benchmark-test-'));
  const file = join(dir, 'config.json');
  try { writeFileSync(file, content, { mode: 0o600 }); action(file); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
test('accepts private complete configuration without displaying values', () => withFile(JSON.stringify(fixture), (file) => {
  const result = run(file);
  assert.equal(result.status, 0); assert.doesNotMatch(result.stdout + result.stderr, /synthetic-/);
}));
test('reports missing and non-string fields without revealing values', () => withFile(JSON.stringify({ ...fixture, SENTRY_ORG: 2, SENTRY_PROJECT: '', extra: 'synthetic-secret' }), (file) => {
  const result = run(file); assert.notEqual(result.status, 0); assert.match(result.stderr, /SENTRY_ORG/); assert.match(result.stderr, /SENTRY_PROJECT/); assert.doesNotMatch(result.stderr, /synthetic-/);
}));
test('rejects insecure permissions', () => withFile(JSON.stringify(fixture), (file) => {
  chmodSync(file, 0o644); const result = run(file); assert.notEqual(result.status, 0); assert.match(result.stderr, /permissions/i);
}));
test('process env overrides file and dotenv is supported', () => withFile(Object.entries({ ...fixture, SENTRY_ORG: '' }).map(([k,v]) => `${k}=${v}`).join('\n'), (file) => {
  const result = run(file, { SENTRY_ORG: 'synthetic-env' }); assert.equal(result.status, 0); assert.doesNotMatch(result.stdout + result.stderr, /synthetic-/);
}));
test('malformed JSON reports no input fragments', () => withFile('{"synthetic-secret":', (file) => {
  const result = run(file); assert.notEqual(result.status, 0); assert.doesNotMatch(result.stderr, /synthetic-secret/);
}));

test('rejects invalid diagnostic label without displaying its value', () => withFile(JSON.stringify(fixture), (file) => {
  const result = run(file, { EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID: 'synthetic@private' }); assert.notEqual(result.status, 0); assert.match(result.stderr, /EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID/); assert.doesNotMatch(result.stderr, /synthetic@private/);
}));

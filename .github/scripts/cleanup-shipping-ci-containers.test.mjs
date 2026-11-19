import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./cleanup-shipping-ci-containers.mjs', import.meta.url);

function runCleanup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'baci-shipping-cleanup-'));
  const log = join(dir, 'docker.log');
  writeFileSync(
    join(dir, 'docker'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_LOG"\nif [ "$1" = ps ]; then [ "${FAKE_PS_FAIL:-0}" = 1 ] && exit 1; [ -f "$DOCKER_LOG.gone" ] || printf "%s\\n" "$FAKE_IDS"; fi\nif [ "$1" = rm ] && [ "${FAKE_RM_FAIL:-0}" = 1 ]; then [ "${FAKE_RM_CLEAR:-0}" = 1 ] && touch "$DOCKER_LOG.gone"; exit 1; fi\nexit 0\n',
    { mode: 0o755 }
  );
  const result = spawnSync(process.execPath, [script.pathname], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      DOCKER_LOG: log,
      FAKE_IDS: 'a'.repeat(64),
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'quality-test',
      ...overrides,
    },
    encoding: 'utf8',
  });
  let calls = '';
  try {
    calls = readFileSync(log, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  rmSync(dir, { recursive: true, force: true });
  return { result, calls };
}

test('removes only containers matching all current CI labels', () => {
  const { result, calls } = runCleanup();
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls, /label=io\.baci\.shipping-ci\.run=123/);
  assert.match(calls, /label=io\.baci\.shipping-ci\.attempt=2/);
  assert.match(calls, /label=io\.baci\.shipping-ci\.job=quality-test/);
  assert.match(calls, /ps -aq --no-trunc/);
  assert.match(calls, /rm -fv a{64}/);
});

test('refuses missing identifiers and malformed container IDs', () => {
  const missing = runCleanup({ GITHUB_RUN_ID: '' });
  assert.notEqual(missing.result.status, 0);
  assert.equal(missing.calls, '');
  const malformed = runCleanup({ FAKE_IDS: '--all' });
  assert.notEqual(malformed.result.status, 0);
  assert.doesNotMatch(malformed.calls, /rm -fv/);
});

test('handles an empty result and propagates Docker errors', () => {
  const empty = runCleanup({ FAKE_IDS: '' });
  assert.equal(empty.result.status, 0);
  assert.doesNotMatch(empty.calls, /rm -fv/);
  const listFailure = runCleanup({ FAKE_PS_FAIL: '1' });
  assert.notEqual(listFailure.result.status, 0);
  assert.doesNotMatch(listFailure.calls, /rm -fv/);
  const removalFailure = runCleanup({ FAKE_RM_FAIL: '1' });
  assert.notEqual(removalFailure.result.status, 0);
  const alreadyGone = runCleanup({ FAKE_RM_FAIL: '1', FAKE_RM_CLEAR: '1' });
  assert.equal(alreadyGone.result.status, 0);
  assert.equal(alreadyGone.calls.match(/ps -aq --no-trunc/g)?.length, 2);
});

test('shipping fixture passes current labels to docker and rejects missing CI identifiers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-shipping-fixture-'));
  const log = join(dir, 'docker.log');
  const harness = new URL(
    '../../supabase/tests/shipping-quote-proof-postgres-test-harness.mjs',
    import.meta.url
  );
  writeFileSync(
    join(dir, 'docker'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_LOG"\nexit 1\n',
    { mode: 0o755 }
  );
  const code = `import {createShippingQuoteProofTestDatabase as create} from ${JSON.stringify(harness.href)}; try { await create().start(); } catch (e) { console.error(e.message); process.exitCode = 1; }`;
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    DOCKER_LOG: log,
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_JOB: 'quality-test',
  };
  try {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', code],
      { env, encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    const calls = readFileSync(log, 'utf8');
    assert.match(calls, /--label io\.baci\.shipping-ci\.run=123/);
    assert.match(calls, /--label io\.baci\.shipping-ci\.attempt=2/);
    assert.match(calls, /--label io\.baci\.shipping-ci\.job=quality-test/);
    writeFileSync(log, '');
    const missing = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', code],
      { env: { ...env, GITHUB_RUN_ID: '' }, encoding: 'utf8' }
    );
    assert.equal(missing.status, 1);
    assert.match(
      missing.stderr,
      /Missing or invalid GitHub Actions identifiers/
    );
    assert.equal(readFileSync(log, 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./cleanup-builder-ci-containers.mjs', import.meta.url);

function runCleanup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'baci-builder-cleanup-'));
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
      GITHUB_JOB: 'quality-typecheck',
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
  assert.match(calls, /label=io\.baci\.builder-ci\.run=123/);
  assert.match(calls, /label=io\.baci\.builder-ci\.attempt=2/);
  assert.match(calls, /label=io\.baci\.builder-ci\.job=quality-typecheck/);
  assert.match(calls, /label=io\.baci\.builder-ci\.scope=single/);
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

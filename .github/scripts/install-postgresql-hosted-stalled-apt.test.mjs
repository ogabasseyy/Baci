import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { STALL_SECONDS, install } from './install-postgresql-hosted-harness.mjs';

// The 2026-11-11 outage did not make apt fail quickly, it made apt wait. The tests in install-postgresql-hosted.test.mjs
// stand in for a quick failure. Here the real timeout(1) runs around an apt-get stand-in that stalls, so the time
// ceiling itself is proven: it must end the stalled command and its helper processes, and the fallback must then run
// and finish the install.
const CEILING_SECONDS = 1;
const hasTimeout = spawnSync('timeout', ['1', 'true']).status === 0;

const aptKinds = (result) =>
  result.commands
    .filter((line) => line.startsWith('apt-get '))
    .map((line) => (/ install /.test(line) ? 'install' : / update$/.test(line) ? 'update' : 'other'));

const isGone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
};

describe('bugfix: a stalled apt command ends at the time ceiling and the fallback finishes the install (2026-11-11 outage)', { skip: !hasTimeout && 'needs timeout(1) on the PATH' }, () => {
  const stalled = (fake) => {
    const started = Date.now();
    const result = install({ FAKE_SUDO_EXEC: '1', APT_LIMIT_SECONDS: String(CEILING_SECONDS), ...fake });
    return { result, seconds: (Date.now() - started) / 1000 };
  };

  test('cuts a stalled install off at the ceiling instead of waiting for it, then installs from the fallback mirrors', () => {
    const { result, seconds } = stalled({ FAKE_APT_HANG_INSTALLS: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(seconds < STALL_SECONDS / 2, `took ${seconds}s: the install stalls for ${STALL_SECONDS}s and must be cut off after ${CEILING_SECONDS}s`);
    assert.match(result.stdout, /The install failed/);
    // refresh, the install that stalled, then the full refresh and the install that works
    assert.deepEqual(aptKinds(result), ['update', 'install', 'update', 'install']);
    assert.ok(result.commands.includes('dpkg --configure -a'), 'dpkg is repaired before the retry');
  });

  test('takes down the helper processes of a stalled command too, so none keeps holding the dpkg lock', async () => {
    const { result } = stalled({ FAKE_APT_HANG_INSTALLS: '1' });
    assert.equal(result.status, 0, result.stderr);
    const helpers = readFileSync(`${result.log}.helpers`, 'utf8').split('\n').filter(Boolean).map(Number);
    assert.equal(helpers.length, 1, 'the stalled install started one helper process');
    // The signal has been delivered by now; give the system a moment to remove the process.
    for (let waited = 0; waited < 3000 && !helpers.every(isGone); waited += 100) await sleep(100);
    for (const pid of helpers) assert.ok(isGone(pid), `helper process ${pid} outlived the ceiling`);
  });

  test('cuts a stalled PGDG-only refresh off at the ceiling, as the dead Azure mirror stalled the old full refresh', () => {
    const { result, seconds } = stalled({ FAKE_APT_HANG_UPDATES: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(seconds < STALL_SECONDS / 2, `took ${seconds}s: the refresh stalls for ${STALL_SECONDS}s and must be cut off after ${CEILING_SECONDS}s`);
    assert.match(result.stdout, /The PostgreSQL-only refresh failed/);
    // the refresh that stalled, then the full refresh and the install; no install runs on the lists that did not refresh
    assert.deepEqual(aptKinds(result), ['update', 'update', 'install']);
  });

  test('gives up with a clear message, after one retry, when the retry stalls too', () => {
    const { result, seconds } = stalled({ FAKE_APT_HANG_INSTALLS: '2' });
    assert.notEqual(result.status, 0);
    assert.ok(seconds < STALL_SECONDS / 2, `took ${seconds}s: two stalled installs must end after ${CEILING_SECONDS}s each`);
    assert.match(result.stderr, /Could not install PostgreSQL 18/);
    assert.deepEqual(aptKinds(result), ['update', 'install', 'update', 'install']);
  });
});

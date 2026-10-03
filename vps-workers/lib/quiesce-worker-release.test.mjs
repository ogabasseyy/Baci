import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const LIB = join(directory, 'quiesce-worker-release.sh');

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o755 });
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'baci-quiesce-'));
  const bin = join(root, 'bin');
  const remote = join(root, 'remote');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(remote, 'locks'), { recursive: true });
  // Leftover lock: present as a file but absent from the crontab.
  writeFileSync(join(remote, 'locks', 'mmm.lock'), '');
  const crontabFixture = join(root, 'crontab.txt');
  writeFileSync(
    crontabFixture,
    [
      '* * * * * flock -n $REMOTE_DIR/locks/error-remediator-global.lock true',
      '* * * * * flock -n $REMOTE_DIR/locks/aaa.lock true',
      '*/5 * * * * flock -n $REMOTE_DIR/locks/gigl-tracking.lock true',
      '* * * * * flock -n $REMOTE_DIR/locks/zzz.lock true',
      '',
    ].join('\n')
  );
  const flockLog = join(root, 'flock.log');
  const systemctlLog = join(root, 'systemctl.log');
  writeExecutable(
    join(bin, 'flock'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "-w" ]; then shift 2; fi
if [ "$1" = "-x" ]; then
  takes=$(($(cat "$FLOCK_COUNT" 2>/dev/null || echo 0) + 1))
  echo "$takes" >"$FLOCK_COUNT"
  echo "take $2" >>"$FLOCK_LOG"
  if [ "\${FLOCK_FAIL_ON_CALL:-0}" = "$takes" ]; then exit 73; fi
fi
`
  );
  writeExecutable(
    join(bin, 'crontab'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "-l" ]; then cat "$CRONTAB_FIXTURE"; fi
`
  );
  writeExecutable(
    join(bin, 'systemctl'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "systemctl $*" >>"$SYSTEMCTL_LOG"
if [ "$1" = "--user" ] && [ "$2" = "is-active" ]; then
  case " $ACTIVE_SERVICES " in *" $4 "*) exit 0;; *) exit 3;; esac
fi
`
  );
  const driver = join(root, 'driver.sh');
  writeExecutable(
    driver,
    `#!/usr/bin/env bash
set -euo pipefail
. "${LIB}"
quiesce_worker_release "${remote}" || { echo QUIESCE-FAILED; exit 3; }
quiesce_worker_release "${remote}" || { echo QUIESCE-FAILED-SECOND; exit 4; }
echo QUIESCE-OK
`
  );
  return { root, bin, remote, flockLog, systemctlLog, driver, crontabFixture };
}

function runDriver(fixture, env = {}) {
  return spawnSync('bash', [fixture.driver], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      ACTIVE_SERVICES: 'baci-domain-event-router baci-quiz-finalization',
      FLOCK_LOG: fixture.flockLog,
      FLOCK_COUNT: join(fixture.root, 'flock-count'),
      CRONTAB_FIXTURE: fixture.crontabFixture,
      SYSTEMCTL_LOG: fixture.systemctlLog,
      ...env,
    },
  });
}

function lockExists(fixture, name) {
  return existsSync(join(fixture.remote, 'locks', name));
}

function flockTakes(fixture) {
  return readFileSync(fixture.flockLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
}

function systemctlCalls(fixture) {
  return readFileSync(fixture.systemctlLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
}

describe('quiesce-worker-release', () => {
  it('quiesces every lock in crontab order with the global lock last', () => {
    const fixture = setup();
    const result = runDriver(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /QUIESCE-OK/);
    // aaa, zzz (crontab order), mmm (leftover file), global deferred
    // last; gigl-tracking skipped (already held by the outer command).
    assert.equal(flockTakes(fixture).length, 4);
    for (const name of [
      'aaa.lock',
      'zzz.lock',
      'mmm.lock',
      'error-remediator-global.lock',
    ]) {
      assert.ok(lockExists(fixture, name), `expected ${name} to be held`);
    }
    assert.ok(!lockExists(fixture, 'gigl-tracking.lock'));
    // The GIGL lock is skipped before opening, so its file is never
    // even created; the second call is a no-op (no extra takes).
    const calls = systemctlCalls(fixture);
    assert.ok(calls.includes('systemctl --user stop baci-domain-event-router'));
    assert.ok(calls.includes('systemctl --user stop baci-quiz-finalization'));
    assert.ok(
      !calls.some((call) => call.includes('stop baci-event-delivery-worker'))
    );
    assert.ok(
      calls.includes('systemctl --user start baci-domain-event-router')
    );
    assert.ok(calls.includes('systemctl --user start baci-quiz-finalization'));
  });

  it('takes the crontab-first lock first', () => {
    const fixture = setup();
    const result = runDriver(fixture, { FLOCK_FAIL_ON_CALL: '1' });
    assert.equal(result.status, 3);
    assert.match(result.stdout, /QUIESCE-FAILED/);
    assert.ok(lockExists(fixture, 'aaa.lock'));
    // mmm.lock pre-exists as the leftover-file fixture, so the take
    // count (not file absence) proves nothing else was touched.
    assert.equal(flockTakes(fixture).length, 1);
    for (const name of ['zzz.lock', 'error-remediator-global.lock']) {
      assert.ok(!lockExists(fixture, name), `expected ${name} to be unopened`);
    }
    // Abort path still restarts what it stopped.
    const calls = systemctlCalls(fixture);
    assert.ok(
      calls.includes('systemctl --user start baci-domain-event-router')
    );
    assert.ok(calls.includes('systemctl --user start baci-quiz-finalization'));
  });

  it('defers the remediation global lock past every per-job lock', () => {
    const fixture = setup();
    const result = runDriver(fixture, { FLOCK_FAIL_ON_CALL: '3' });
    assert.equal(result.status, 3);
    for (const name of ['aaa.lock', 'zzz.lock', 'mmm.lock']) {
      assert.ok(lockExists(fixture, name), `expected ${name} to be held`);
    }
    assert.equal(flockTakes(fixture).length, 3);
    assert.ok(!lockExists(fixture, 'error-remediator-global.lock'));
  });

  it('is sourced from live by the emergency rollback procedure', () => {
    const runbook = readFileSync(
      join(directory, '..', 'docs', 'gigl-tracking-cutover-runbook.md'),
      'utf8'
    );
    assert.match(
      runbook,
      /\.\s"\$REMOTE_DIR\/lib\/quiesce-worker-release\.sh"/
    );
    assert.match(runbook, /quiesce_worker_release "\$REMOTE_DIR" \|\| exit 1/);
  });
});

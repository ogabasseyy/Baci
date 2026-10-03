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

  it('defers a renamed remediation global lock past every per-job lock', () => {
    const fixture = setup();
    // Live tree with a custom global lock path, read through the real
    // staged reader (copied verbatim, so this tests the production
    // parse path, not a stub).
    mkdirSync(join(fixture.remote, 'bin'), { recursive: true });
    writeFileSync(
      join(fixture.remote, 'bin', 'gigl-dotenv.sh'),
      readFileSync(
        join(directory, '..', '..', '.github', 'scripts', 'gigl-dotenv.sh'),
        'utf8'
      )
    );
    writeFileSync(
      join(fixture.remote, '.env'),
      'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom-global.lock\n'
    );
    writeFileSync(
      fixture.crontabFixture,
      [
        '* * * * * flock -n $REMOTE_DIR/locks/custom-global.lock true',
        '* * * * * flock -n $REMOTE_DIR/locks/aaa.lock true',
        '*/5 * * * * flock -n $REMOTE_DIR/locks/gigl-tracking.lock true',
        '* * * * * flock -n $REMOTE_DIR/locks/zzz.lock true',
        '',
      ].join('\n')
    );
    // Fail on the 3rd take: with the fix the order is aaa, zzz, mmm,
    // custom-global (deferred last despite appearing first), so the
    // custom file is never opened. Without the fix the hardcoded
    // default would not match and custom-global would take first.
    const result = runDriver(fixture, { FLOCK_FAIL_ON_CALL: '3' });
    assert.equal(result.status, 3);
    for (const name of ['aaa.lock', 'zzz.lock', 'mmm.lock']) {
      assert.ok(lockExists(fixture, name), `expected ${name} to be held`);
    }
    assert.equal(flockTakes(fixture).length, 3);
    assert.ok(!lockExists(fixture, 'custom-global.lock'));
    // The default name never appears: the configured name is the one
    // deferred, so no fd is ever opened for the default.
    assert.ok(!lockExists(fixture, 'error-remediator-global.lock'));
  });

  it('holds an absolute global lock path exactly and last', () => {
    const fixture = setup();
    // NOTE: the directory is deliberately not *-locks: the crontab
    // grep matches any "locks/<name>.lock" substring, so a *-locks
    // custom dir would ALSO leak its basename into the name loop (a
    // harmless extra hold, but noise for this test).
    const customDir = join(fixture.root, 'custom');
    mkdirSync(customDir, { recursive: true });
    const customPath = join(customDir, 'remediation.lock');
    mkdirSync(join(fixture.remote, 'bin'), { recursive: true });
    writeFileSync(
      join(fixture.remote, 'bin', 'gigl-dotenv.sh'),
      readFileSync(
        join(directory, '..', '..', '.github', 'scripts', 'gigl-dotenv.sh'),
        'utf8'
      )
    );
    writeFileSync(
      join(fixture.remote, '.env'),
      `BACI_REMEDIATION_GLOBAL_LOCK_PATH=${customPath}\n`
    );
    // The transition writes the absolute path into the entries; the
    // locks/ grep cannot see it, so the loop holds only per-job locks.
    writeFileSync(
      fixture.crontabFixture,
      [
        `* * * * * flock -n ${customPath} true`,
        '* * * * * flock -n $REMOTE_DIR/locks/aaa.lock true',
        '*/5 * * * * flock -n $REMOTE_DIR/locks/gigl-tracking.lock true',
        '* * * * * flock -n $REMOTE_DIR/locks/zzz.lock true',
        '',
      ].join('\n')
    );
    // Fail on the 3rd take: the loop holds aaa, zzz, mmm first and the
    // exact path is never reached (its file is created by the hold).
    const failing = runDriver(fixture, { FLOCK_FAIL_ON_CALL: '3' });
    assert.equal(failing.status, 3);
    for (const name of ['aaa.lock', 'zzz.lock', 'mmm.lock']) {
      assert.ok(lockExists(fixture, name), `expected ${name} to be held`);
    }
    assert.equal(flockTakes(fixture).length, 3);
    assert.ok(!existsSync(customPath));
    assert.ok(!lockExists(fixture, 'remediation.lock'));

    const passing = setup();
    mkdirSync(join(passing.root, 'custom'), { recursive: true });
    const passingPath = join(passing.root, 'custom', 'remediation.lock');
    mkdirSync(join(passing.remote, 'bin'), { recursive: true });
    writeFileSync(
      join(passing.remote, 'bin', 'gigl-dotenv.sh'),
      readFileSync(
        join(directory, '..', '..', '.github', 'scripts', 'gigl-dotenv.sh'),
        'utf8'
      )
    );
    writeFileSync(
      join(passing.remote, '.env'),
      `BACI_REMEDIATION_GLOBAL_LOCK_PATH=${passingPath}\n`
    );
    writeFileSync(
      passing.crontabFixture,
      readFileSync(fixture.crontabFixture, 'utf8').replaceAll(
        customPath,
        passingPath
      )
    );
    const result = runDriver(passing);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /QUIESCE-OK/);
    assert.equal(flockTakes(passing).length, 4);
    // The exact hold created the file (append-open); the basename was
    // never held through locks/.
    assert.ok(existsSync(passingPath));
    assert.ok(!lockExists(passing, 'remediation.lock'));
  });

  it('treats a same-inode locks/ spelling as the standard case', () => {
    const fixture = setup();
    // locks/../locks/x.lock resolves to the locks/ file the loop
    // already holds: without normalization the exact hold would take
    // the same inode on a second fd and self-deadlock (flock locks
    // are per open-file-description).
    writeFileSync(join(fixture.remote, 'locks', 'baci-global.lock'), '');
    mkdirSync(join(fixture.remote, 'bin'), { recursive: true });
    writeFileSync(
      join(fixture.remote, 'bin', 'gigl-dotenv.sh'),
      readFileSync(
        join(directory, '..', '..', '.github', 'scripts', 'gigl-dotenv.sh'),
        'utf8'
      )
    );
    writeFileSync(
      join(fixture.remote, '.env'),
      'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/../locks/baci-global.lock\n'
    );
    writeFileSync(
      fixture.crontabFixture,
      [
        '* * * * * flock -n $REMOTE_DIR/locks/baci-global.lock true',
        '* * * * * flock -n $REMOTE_DIR/locks/aaa.lock true',
        '*/5 * * * * flock -n $REMOTE_DIR/locks/gigl-tracking.lock true',
        '* * * * * flock -n $REMOTE_DIR/locks/zzz.lock true',
        '',
      ].join('\n')
    );
    const result = runDriver(fixture);
    assert.equal(result.status, 0, result.stderr);
    // aaa, zzz, mmm, then the deferred basename: 4 takes, no second
    // exact fd on the same inode.
    assert.equal(flockTakes(fixture).length, 4);
    assert.ok(lockExists(fixture, 'baci-global.lock'));
  });

  it('falls back to the default global lock without a dotenv reader', () => {
    const fixture = setup();
    // A custom value the quiesce cannot read (first install, legacy
    // tree): the default keeps its deferral, the custom name is never
    // resolved.
    writeFileSync(
      join(fixture.remote, '.env'),
      'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom-global.lock\n'
    );
    const result = runDriver(fixture, { FLOCK_FAIL_ON_CALL: '3' });
    assert.equal(result.status, 3);
    for (const name of ['aaa.lock', 'zzz.lock', 'mmm.lock']) {
      assert.ok(lockExists(fixture, name), `expected ${name} to be held`);
    }
    assert.equal(flockTakes(fixture).length, 3);
    assert.ok(!lockExists(fixture, 'error-remediator-global.lock'));
    assert.ok(!lockExists(fixture, 'custom-global.lock'));
  });

  it('is sourced from live by the emergency rollback procedure', () => {
    const runbook = readFileSync(
      join(directory, '..', 'docs', 'gigl-tracking-cutover-runbook.md'),
      'utf8'
    );
    assert.match(
      runbook,
      /\.\s"\$remote_dir\/lib\/quiesce-worker-release\.sh"/
    );
    assert.match(runbook, /quiesce_worker_release "\$remote_dir" \|\| exit 1/);
  });
});

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
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const QUIESCE_LIB = join(directory, 'quiesce-worker-release.sh');

export function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o755 });
}

export function setup() {
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
. "${QUIESCE_LIB}"
quiesce_worker_release "${remote}" || { echo QUIESCE-FAILED; exit 3; }
quiesce_worker_release "${remote}" || { echo QUIESCE-FAILED-SECOND; exit 4; }
echo QUIESCE-OK
`
  );
  return { root, bin, remote, flockLog, systemctlLog, driver, crontabFixture };
}

export function runDriver(fixture, env = {}) {
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

export function lockExists(fixture, name) {
  return existsSync(join(fixture.remote, 'locks', name));
}

export function flockTakes(fixture) {
  return readFileSync(fixture.flockLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
}

export function systemctlCalls(fixture) {
  return readFileSync(fixture.systemctlLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
}

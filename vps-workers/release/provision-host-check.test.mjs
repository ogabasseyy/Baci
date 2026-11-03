import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  executable,
  linuxOnly,
  releaseDir,
} from './release-host.test-fixtures.mjs';

const SWITCH_DENIED = /cannot switch to baci-worker without a password/;

// Runs the readiness check as "root" with stubbed identity tools; `su`
// reports whether the deploy user's passwordless switch is allowed.
function runCheck({ switchAllowed }) {
  const base = mkdtempSync(join(tmpdir(), 'baci-provision-check-'));
  const stubs = join(base, 'stubs');
  const root = join(base, 'srv', 'baci-worker');
  mkdirSync(root, { recursive: true });
  executable(
    join(stubs, 'id'),
    `case "$*" in -u) echo 0 ;; '-u baci-worker') echo 999 ;; '-nG baci-worker') echo baci-worker ;; *) exit 1 ;; esac\n`
  );
  executable(join(stubs, 'su'), `exit ${switchAllowed ? 0 : 1}\n`);
  return spawnSync(
    'bash',
    ['-c', `source "${join(releaseDir, 'provision-host.sh')}" && check`],
    {
      encoding: 'utf8',
      env: {
        PATH: `${stubs}:/usr/bin:/bin`,
        BACI_DEPLOY_USER: 'deploy',
        BACI_WORKER_ROOT: root,
        BACI_WORKER_SUDOERS_FILE: join(base, 'sudoers-baci-worker'),
      },
    }
  );
}

test(
  'bugfix: reports not ready when a later sudoers rule denies the passwordless switch',
  linuxOnly,
  () => {
    const result = runCheck({ switchAllowed: false });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, SWITCH_DENIED);
  }
);

test(
  'does not report the switch when the passwordless switch works',
  linuxOnly,
  () => {
    const result = runCheck({ switchAllowed: true });

    assert.doesNotMatch(result.stdout, SWITCH_DENIED);
  }
);

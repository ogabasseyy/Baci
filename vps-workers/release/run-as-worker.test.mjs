import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  executable,
  linuxOnly,
  releaseDir,
  SHA,
} from './release-host.test-fixtures.mjs';

test(
  'run-as-worker passes only allowlisted settings into installed scripts',
  linuxOnly,
  () => {
    const base = mkdtempSync(join(tmpdir(), 'baci-run-as-worker-'));
    const stubs = join(base, 'stubs');
    const root = join(base, 'root');
    executable(
      join(stubs, 'sudo'),
      'while [ "$#" -gt 0 ] && [ "$1" != -- ]; do case "$1" in -u) shift 2 ;; -*) shift ;; *) break ;; esac; done; [ "$1" != -- ] || shift; exec "$@"\n'
    );
    executable(join(stubs, 'id'), 'echo 999\n');
    executable(
      join(root, 'app-live/vps-workers/bin/check.sh'),
      'env | sort; echo "args=$*"\n'
    );
    const env = {
      PATH: `${stubs}:/usr/bin:/bin`,
      BACI_WORKER_ROOT: root,
      BACI_EXPECTED_APP_SHA: SHA,
      GITHUB_TOKEN: 'runner-secret',
    };
    const run = (script) =>
      spawnSync(
        'bash',
        [join(releaseDir, 'run-as-worker.sh'), script, '--flag'],
        { env, encoding: 'utf8' }
      );

    const result = run('vps-workers/bin/check.sh');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`BACI_EXPECTED_APP_SHA=${SHA}`));
    assert.match(
      result.stdout,
      new RegExp(`VPS_WORKER_REMOTE_DIR=${root}/baci-workers`)
    );
    assert.match(result.stdout, /args=--flag/);
    assert.doesNotMatch(result.stdout, /runner-secret/);

    assert.notEqual(run('../outside.sh').status, 0);
    assert.notEqual(run('/etc/passwd.sh').status, 0);
  }
);

test(
  'run-as-worker refuses a configured worker directory outside the release root',
  linuxOnly,
  () => {
    const base = mkdtempSync(join(tmpdir(), 'baci-run-as-worker-'));
    const stubs = join(base, 'stubs');
    const root = join(base, 'root');
    executable(join(stubs, 'sudo'), 'exit 99\n');
    executable(join(stubs, 'id'), 'echo 999\n');
    executable(join(root, 'app-live/vps-workers/bin/check.sh'), 'true\n');

    const result = spawnSync(
      'bash',
      [join(releaseDir, 'run-as-worker.sh'), 'vps-workers/bin/check.sh'],
      {
        encoding: 'utf8',
        env: {
          PATH: `${stubs}:/usr/bin:/bin`,
          BACI_WORKER_ROOT: root,
          VPS_WORKER_REMOTE_DIR: '/home/deploy/baci-workers',
        },
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VPS_WORKER_REMOTE_DIR must be/);
  }
);

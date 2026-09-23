import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const verifier = join(
  workerRoot,
  'bin',
  'verify-cache-invalidation-drain-installed.sh'
);

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function runVerifier(crontab) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-drain-readiness-'));
  const binDirectory = join(directory, 'bin');
  const remoteDirectory = join(directory, 'workers');

  try {
    mkdirSync(binDirectory);
    mkdirSync(join(remoteDirectory, 'jobs'), { recursive: true });
    writeFileSync(
      join(remoteDirectory, 'jobs', 'run-cache-invalidation-cron.mjs'),
      ''
    );
    writeExecutable(
      join(binDirectory, 'crontab'),
      `#!/usr/bin/env bash
set -euo pipefail
[ "\${1:-}" = "-l" ]
printf '%s\n' "\${TEST_INSTALLED_CRONTAB:-}"
`
    );

    return spawnSync('bash', [verifier], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        TEST_INSTALLED_CRONTAB: crontab.replaceAll(
          '__REMOTE_DIR__',
          remoteDirectory
        ),
        VPS_WORKER_REMOTE_DIR: remoteDirectory,
      },
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function drainEntry(remoteDirectory = '__REMOTE_DIR__') {
  return `*/2 * * * * flock -n ${remoteDirectory}/locks/cache-invalidations.lock bash -lc 'export CACHE_INVALIDATION_STATE_FILE=${remoteDirectory}/state/cache-invalidations.json && cd ${remoteDirectory} && /usr/bin/node ${remoteDirectory}/jobs/run-cache-invalidation-cron.mjs' >> ${remoteDirectory}/logs/cache-invalidations.log 2>&1`;
}

describe('cache-invalidation drain rollout readiness', () => {
  it('accepts one installed two-minute drain entry', () => {
    const result = runVerifier(drainEntry());

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /on the deploy runner/);
    assert.match(result.stdout, /Cache-invalidation drain is installed/);
  });

  it('fails closed when the drain entry is absent', () => {
    const result = runVerifier('0 * * * * /usr/bin/true');

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Expected exactly one active two-minute cache-invalidation drain; found 0/
    );
    assert.match(result.stderr, /vps-workers\/deploy\.sh/);
  });

  it('fails closed when duplicate drain entries are installed', () => {
    const entry = drainEntry();
    const result = runVerifier(`${entry}\n${entry}`);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Expected exactly one active two-minute cache-invalidation drain; found 2/
    );
  });

  it('rejects a suffixed disabled runner path', () => {
    const result = runVerifier(
      drainEntry().replace(
        'run-cache-invalidation-cron.mjs',
        'run-cache-invalidation-cron.mjs.disabled'
      )
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Expected exactly one active two-minute cache-invalidation drain; found 0/
    );
  });
});

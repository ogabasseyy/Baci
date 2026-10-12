import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODEX_JOB_COUNT = 3;

// Replicates the runbook emergency-rollback extraction: sed the
// REMOTE_SH merge block out of deploy.sh (dropping the ssh opener
// and the close delimiter, like `sed '1d;$d'`), then invoke it the
// way the rollback does — four args, marker from the fragment's own
// first/last lines — against a stub crontab.
function runRollbackExtractedMerge({ extraArgs = [], markerSha = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-cron-merge-'));
  try {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const lines = deployScript.split('\n');
    const openIndex = lines.findIndex((line) =>
      line.includes("<<'REMOTE_SH'")
    );
    const closeIndex = lines.findIndex((line) => line === 'REMOTE_SH');
    assert.ok(openIndex >= 0 && closeIndex > openIndex);
    const mergePath = join(directory, 'merge.sh');
    writeFileSync(join(directory, 'merge.sh'), `${lines.slice(openIndex + 1, closeIndex).join('\n')}\n`);
    const remoteDir = join(directory, 'remote');
    const fragmentPath = join(directory, 'fragment');
    const start = '# >>> baci-workers >>>';
    const end = '# <<< baci-workers <<<';
    writeFileSync(
      fragmentPath,
      `${start}\n* * * * * echo rollback-merge-probe\n${end}\n`
    );
    if (markerSha !== null) {
      mkdirSync(remoteDir, { recursive: true });
      writeFileSync(join(remoteDir, 'app-checkout.sha'), markerSha);
    }
    const installedPath = join(directory, 'installed-crontab');
    const binDir = join(directory, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, 'crontab'),
      `#!/usr/bin/env bash\nif [ "$1" = "-l" ]; then exit 1; fi\ncp "$1" "${installedPath}"\n`,
      { mode: 0o755 }
    );
    const result = spawnSync(
      'bash',
      [mergePath, fragmentPath, remoteDir, start, end, ...extraArgs],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
      }
    );
    let installed = '';
    try {
      installed = readFileSync(installedPath, 'utf8');
    } catch {
      // A refused install writes nothing.
    }
    return { result, installed };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('remediation deploy crontab', () => {
  it('installs the remediation lock handoff after the recorded promotion', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const transitionScript = readFileSync(
      join(workerRoot, 'lib/install-remediation-cron-transition.sh'),
      'utf8'
    );
    const transitionHelper = readFileSync(
      join(workerRoot, 'lib/remediation-cron-transition.py'),
      'utf8'
    );
    const crontabHelper = readFileSync(
      join(workerRoot, 'lib/remediation_cron_transition_crontab.py'),
      'utf8'
    );

    assert.match(deployScript, /vercel-error-remediator\.lock bash -lc/);
    assert.match(deployScript, /sentry-mobile-error-remediator\.lock bash -lc/);
    assert.match(
      deployScript,
      /install -d -m 700 \$REMOTE_DIR\/locks && touch \$REMOTE_DIR\/locks\/error-remediator-global\.lock && chmod 600 \$REMOTE_DIR\/locks\/error-remediator-global\.lock/
    );
    assert.doesNotMatch(deployScript, /BACI_REMEDIATION_GLOBAL_FLOCK_HELD/);
    assert.match(transitionScript, /flock -x \/tmp\/baci-workers-deploy\.lock/);
    assert.match(transitionScript, /BACI_REMEDIATION_PROC_ROOT:-\/proc/);
    assert.match(transitionScript, /proc_root="\$8"/);
    assert.match(transitionScript, /"\$proc_root"/);
    assert.match(
      transitionScript,
      /flock -w "\$lock_wait_seconds" -x "\$descriptor"/
    );
    assert.match(transitionScript, /hold_lock 6/);
    assert.match(crontabHelper, /exec flock -F /);
    assert.match(transitionHelper, /'vercel-error-remediator'.*'-n'/);
    assert.match(transitionHelper, /'sentry-mobile-error-remediator'.*'-n'/);
    assert.match(transitionHelper, /'remediation-codex-canary'.*'-w 600'/);
    const transition = deployScript.indexOf(
      'install_remediation_cron_transition'
    );
    const promotion = deployScript.indexOf('promote_worker_release');
    const finalCron = deployScript.indexOf(
      'Installing crontab entries on VPS (idempotent)'
    );
    // The transition runs after the recorded promote (and its
    // rollback-on-refresh-failure): promote's quiesce then sees only
    // legacy entries — candidate ticks cannot exist mid-promote — and
    // a refresh failure rolls back a tree the transition never touched.
    assert.ok(
      promotion > 0 && promotion < transition && transition < finalCron,
      'expected promote, then the cron transition, then the final schedule'
    );
  });

  it('refuses the final crontab install when a concurrent promote superseded this deployment', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const cronBlock = deployScript.slice(
      deployScript.indexOf('Installing crontab entries on VPS (idempotent)')
    );

    // The crontab carries this deployment's pinned image tag: the
    // locked, marker-checked install refuses a stale write after a
    // concurrent promote instead of mixing schedules under B's marker.
    assert.match(cronBlock, /flock -x \/tmp\/baci-workers-deploy\.lock bash -s/);
    assert.match(cronBlock, /expected_sha="\$\{5:-\}"/);
    assert.match(cronBlock, /cat "\$remote_dir\/app-checkout\.sha"/);
    assert.ok(
      cronBlock.indexOf('is not this deployment') <
        cronBlock.indexOf('crontab "$tmp_file"'),
      'expected the marker refusal before the crontab install'
    );
    // The emergency rollback anchor-extracts this block and invokes it
    // with four args under its own deploy lock: a missing fifth arg
    // must skip loudly, never trip set -u mid-restore.
    assert.match(cronBlock, /manual rollback mode/);
  });

  it('installs the schedule when the rollback-extracted merge runs with four args', () => {
    const { result, installed } = runRollbackExtractedMerge();

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /manual rollback mode/);
    assert.match(installed, /rollback-merge-probe/);
    assert.match(installed, /# >>> baci-workers >>>/);
  });

  it('refuses the extracted merge when a fifth arg names a superseded deployment', () => {
    const { result, installed } = runRollbackExtractedMerge({
      extraArgs: ['f'.repeat(40)],
      markerSha: 'e'.repeat(40),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is not this deployment/);
    assert.equal(installed, '');
  });

  it('keeps the canary wait window while leaving global acquisition to its entrypoint', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const canaryCronLine = deployScript
      .split('\n')
      .filter(
        (line) =>
          line.includes('22 4') &&
          line.includes('jobs/remediation-codex-canary.mjs')
      )
      .at(-1);

    assert.ok(canaryCronLine);
    assert.match(
      canaryCronLine,
      /22 4\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/remediation-codex-canary\.lock bash -lc 'export BACI_CODEX_DOCKER_IMAGE=/
    );
    assert.doesNotMatch(canaryCronLine, /BACI_REMEDIATION_CANARY_ENABLED=/);
    assert.match(canaryCronLine, /jobs\/remediation-codex-canary\.mjs/);
    assert.match(
      canaryCronLine,
      />> \$REMOTE_DIR\/logs\/remediation-codex-canary\.log 2>&1/
    );
  });

  it('builds and configures the capability-free Codex container backend', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(
      deployScript,
      /docker build -f \$STAGING_DIR\/Dockerfile\.codex-remediator -t \$CODEX_REMEDIATOR_IMAGE \$STAGING_DIR/
    );
    assert.equal(
      deployScript.match(/BACI_CODEX_DOCKER_IMAGE=\$CODEX_REMEDIATOR_IMAGE/g)
        ?.length,
      CODEX_JOB_COUNT,
      'expected every remediation Codex job to receive the pinned image'
    );
    assert.match(deployScript, /CODEX_CONTAINER_BIN=.*find/);
    assert.ok(
      deployScript.indexOf('prepare_worker_release') <
        deployScript.indexOf('CODEX_CONTAINER_BIN=$(ssh')
    );
    assert.equal(
      deployScript.match(/BACI_CODEX_CONTAINER_BIN=\$CODEX_CONTAINER_BIN/g)
        ?.length,
      CODEX_JOB_COUNT,
      'expected every remediation Codex job to receive the native Codex binary'
    );
    assert.match(
      deployScript,
      /CODEX_READONLY_SECCOMP_PROFILE="\$REMOTE_DIR\/config\/codex-readonly-seccomp\.json"/
    );
    assert.equal(
      deployScript.match(
        /BACI_CODEX_READONLY_SECCOMP_PROFILE=\$CODEX_READONLY_SECCOMP_PROFILE/g
      )?.length,
      CODEX_JOB_COUNT,
      'expected every remediation Codex job to receive the read-only seccomp profile'
    );
  });
});

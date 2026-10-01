import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODEX_JOB_COUNT = 3;

describe('remediation deploy crontab', () => {
  it('installs the remediation lock handoff before full promotion', () => {
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
    assert.ok(
      transition > 0 && transition < promotion && promotion < finalCron
    );
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

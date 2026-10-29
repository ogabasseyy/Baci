import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = join(import.meta.dirname, '..', '..');
const deployScript = readFileSync(
  join(repoRoot, 'vps-workers', 'deploy.sh'),
  'utf8'
);
const releaseHelper = readFileSync(
  join(repoRoot, 'vps-workers', 'lib', 'prepare-worker-release.sh'),
  'utf8'
);

describe('GIGL direct worker cost contract', () => {
  it('does not schedule GIGL tracking through Vercel Cron', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'vercel.json'), 'utf8')
    );
    const paths = config.crons.map((cron) => cron.path);

    assert.ok(!paths.includes('/api/cron/gigl-tracking'));
    assert.ok(paths.includes('/api/cron/gigl-tracking-notifications'));
  });

  it('treats Vercel configuration as a production deployment input', () => {
    const deployFilter = readFileSync(
      join(repoRoot, '.github', 'filters', 'deploy.yml'),
      'utf8'
    );

    assert.match(deployFilter, /^\s+- 'vercel\.json'\s*$/m);
  });

  it('treats Vercel configuration as a CI web input', () => {
    const ciFilter = readFileSync(
      join(repoRoot, '.github', 'filters', 'ci.yml'),
      'utf8'
    );

    assert.match(ciFilter, /^\s+- 'vercel\.json'\s*$/m);
  });

  it('schedules tracking directly every five minutes', () => {
    const cronLines = deployScript
      .split('\n')
      .filter((line) => line.includes('gigl-tracking.lock'));

    // A duplicated crontab line would cause two pollers to contend on the
    // same flock and can hide a broken lock contract. Keep this worker's
    // schedule singular in the generated production crontab.
    assert.equal(cronLines.length, 1, 'GIGL tracking must have one cron entry');
    const cronLine = cronLines[0];

    assert.ok(cronLine);
    assert.match(
      cronLine,
      /^\*\/5 \*\s+\* \* \* flock -n \$LOCK_DIR\/gigl-tracking\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=gigl-tracking && export GIGL_ENV_FILE_AUTHORITATIVE=1 && cd \$REMOTE_DIR && timeout --signal=TERM --kill-after=30s 2m \$REMOTE_DIR\/bin\/process-gigl-tracking\.sh' >> \$REMOTE_DIR\/logs\/gigl-tracking\.log 2>&1$/
    );
    assert.doesNotMatch(cronLine, /run-web-cron|\/api\/cron\/gigl-tracking/);
  });

  it('keeps brokered worker promotion fail-closed behind the quiescence lease', () => {
    const coordinator = readFileSync(
      join(repoRoot, '.github', 'workflows', 'production-release.yml'),
      'utf8'
    );
    const coordinatorScript = readFileSync(
      join(repoRoot, '.github', 'scripts', 'worker-release-coordinator.mjs'),
      'utf8'
    );
    const brokerDispatch = readFileSync(
      join(repoRoot, 'vps-workers', 'bin', 'worker_release_broker_dispatch.py'),
      'utf8'
    );
    const quiesceAdapter = readFileSync(
      join(
        repoRoot,
        'vps-workers',
        'lib',
        'worker-release-quiesce-adapter.mjs'
      ),
      'utf8'
    );

    assert.match(coordinator, /worker-release-coordinator\.mjs/);
    assert.match(coordinatorScript, /operation: 'promote'/);
    assert.match(coordinatorScript, /operation: 'health'/);
    assert.match(coordinatorScript, /operation: 'rollback'/);
    assert.match(
      brokerDispatch,
      /quiescence = WorkerQuiesceLeaseManager\(worker_uid=worker_uid, worker_gid=worker_gid\)/
    );
    assert.match(
      brokerDispatch,
      /lease = quiescence\.acquire\(identity\.fence\(\), previous_sha=prior\)/
    );
    assert.match(
      brokerDispatch,
      /lease = quiescence\.require_active\(identity\.fence\(\)\)/
    );
    assert.match(brokerDispatch, /operation in \("recovery-status", "recover"\)/);
    assert.match(brokerDispatch, /return recovery_status\(source_sha=sha, quiescence=quiescence/);
    assert.match(
      brokerDispatch,
      /return recover\([\s\S]*identity=identity, quiescence=quiescence/
    );
    assert.match(
      coordinatorScript,
      /recovery-status[\s\S]*operation: 'recover'[\s\S]*recoveryOf: target/
    );
    assert.match(
      quiesceAdapter,
      /throw new Error\([\s\S]*refusing promotion or rollback/
    );
  });

  it('keeps the privileged notification graph off the VPS', () => {
    const cronLine = deployScript
      .split('\n')
      .find((line) => line.includes('gigl-tracking-notifications.lock'));

    assert.equal(cronLine, undefined);
  });

  it('requires the direct scripts and wrappers in the exact-SHA release', () => {
    const provisioner = readFileSync(
      join(repoRoot, 'vps-workers', 'lib', 'provision-immutable-checkout.sh'),
      'utf8'
    );
    assert.match(
      provisioner,
      /apps\/web\/src\/scripts\/process-gigl-tracking\.ts/
    );
    assert.match(
      provisioner,
      /"\$staging_dir\/bin\/process-gigl-tracking\.sh"/
    );
    assert.match(provisioner, /verify-gigl-tracking-worker-capability\.sh/);
    assert.match(releaseHelper, /lib\/provision-immutable-checkout\.sh/);
  });

  it('runs the GIGL gate suites in the deployment-scripts CI step', () => {
    const ci = readFileSync(
      join(repoRoot, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    const step = ci
      .split('- name: Test Deployment and VPS Worker Scripts')[1]
      .split(/^\s+- name: /m)[0];

    for (const suite of [
      'check-gigl-cutover-latch.test.mjs',
      'check-gigl-cutover-latch-scope.test.mjs',
      'gigl-dotenv.test.mjs',
      'resolve-gigl-latch-identity.test.mjs',
      'verify-gigl-fallback-token.test.mjs',
      'smoke-gigl-worker-capability.test.mjs',
      'verify-gigl-worker-final-state.test.sh',
    ]) {
      assert.match(
        step,
        new RegExp(suite.replaceAll('.', '\\.')),
        `${suite} must be registered in the Test Deployment and VPS Worker Scripts step`
      );
    }
  });

  it('routes releases through the exact-SHA worker coordinator', () => {
    const coordinator = readFileSync(
      join(repoRoot, '.github', 'workflows', 'production-release.yml'),
      'utf8'
    );
    assert.match(
      coordinator,
      /node \.github\/scripts\/worker-release-coordinator\.mjs/
    );
    assert.match(coordinator, /expected_release_sha: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(
      coordinator,
      /Warn on manifest-only worker dependency drift/
    );
  });

  it('selects deploy_scripts for GIGL gate script changes', () => {
    const ciFilter = readFileSync(
      join(repoRoot, '.github', 'filters', 'ci.yml'),
      'utf8'
    );
    const group = ciFilter
      .split(/^deploy_scripts:\s*$/m)[1]
      .split(/^\w[\w-]*:\s*$/m)[0];

    for (const path of [
      '.github/scripts/check-gigl-cutover-latch.sh',
      '.github/scripts/resolve-gigl-latch-identity.sh',
      '.github/scripts/verify-gigl-fallback-token.sh',
      '.github/scripts/verify-gigl-worker-final-state.sh',
      '.github/scripts/smoke-gigl-worker-capability.sh',
    ]) {
      assert.match(
        group,
        new RegExp(`^\\s+- '${path.replaceAll('.', '\\.')}'\\s*$`, 'm'),
        `${path} must select the deploy_scripts filter group`
      );
    }
  });
});

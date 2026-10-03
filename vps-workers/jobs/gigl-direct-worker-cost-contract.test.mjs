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
    const cronLine = deployScript
      .split('\n')
      .find((line) => line.includes('gigl-tracking.lock'));

    assert.ok(cronLine);
    assert.match(
      cronLine,
      /^\*\/5 \*\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/gigl-tracking\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=gigl-tracking && export GIGL_ENV_FILE_AUTHORITATIVE=1 && cd \$REMOTE_DIR && timeout --signal=TERM --kill-after=30s 2m \$REMOTE_DIR\/bin\/process-gigl-tracking\.sh' >> \$REMOTE_DIR\/logs\/gigl-tracking\.log 2>&1$/
    );
    assert.doesNotMatch(cronLine, /run-web-cron|\/api\/cron\/gigl-tracking/);
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

  it('warns (never blocks) on manifest-only worker dependency drift', () => {
    const deployFilter = readFileSync(
      join(repoRoot, '.github', 'filters', 'deploy.yml'),
      'utf8'
    );
    const group = deployFilter
      .split(/^manifests:\s*$/m)[1]
      .split(/^\w[\w-]*:\s*$/m)[0];
    assert.match(group, /^\s+- 'package\.json'\s*$/m);
    assert.match(group, /^\s+- 'pnpm-lock\.yaml'\s*$/m);
    assert.match(group, /^\s+- 'pnpm-workspace\.yaml'\s*$/m);
    assert.match(group, /^\s+- '\.npmrc'\s*$/m);
    assert.match(group, /^\s+- 'apps\/web\/package\.json'\s*$/m);

    const deploy = readFileSync(
      join(repoRoot, '.github', 'workflows', 'deploy.yml'),
      'utf8'
    );
    assert.match(
      deploy,
      /manifests: \$\{\{ steps\.filter\.outputs\.manifests \}\}/
    );
    const step = deploy
      .split('- name: Warn on manifest-only worker dependency drift')[1]
      .split(/^\s+- name: /m)[0];
    assert.match(
      step,
      /needs\.changes\.outputs\.manifests == 'true' && needs\.changes\.outputs\.tracking != 'true'/
    );
    assert.match(step, /::warning::/);
    assert.doesNotMatch(step, /::error::/);
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

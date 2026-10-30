import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(
  join(workerRoot, '..', '.github', 'workflows', 'deploy.yml'),
  'utf8'
);

function jobBlock(name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = workflow.indexOf(`  ${nextName}:`, start + 1);

  assert.notEqual(start, -1, `missing ${name} job`);
  assert.notEqual(end, -1, `missing ${nextName} job after ${name}`);
  return workflow.slice(start, end);
}

describe('production worker readiness and capability gates', () => {
  it('verifies the installed VPS drain before production migrations', () => {
    const readiness = jobBlock('vps-drain-readiness', 'db-migrations');
    const migrations = jobBlock('db-migrations', 'deploy-production');

    assert.match(readiness, /runs-on: baci-deploy/);
    assert.match(
      readiness,
      /vps-workers\/bin\/verify-cache-invalidation-drain-installed\.sh/
    );
    assert.match(
      readiness,
      /^\s+run: bash \.readiness-checkout\/vps-workers\/release\/run-as-worker\.sh vps-workers\/bin\/verify-gigl-direct-workers-installed\.sh --skip-live-smoke$/m
    );
    // The cutover marker runs on every push (no changeset condition),
    // so an unrelated web push cannot deploy the cron removal while the
    // worker was never installed.
    assert.match(
      readiness,
      /^\s+run: bash \.readiness-checkout\/vps-workers\/release\/run-as-worker\.sh vps-workers\/bin\/verify-gigl-direct-workers-installed\.sh --cutover-marker$/m
    );
    assert.match(readiness, /needs: \[changes, vps-worker-sync\]/);
    assert.match(readiness, /needs\.changes\.outputs\.tracking != 'false'/);
    assert.doesNotMatch(readiness, /outputs\.migrations/);
    assert.doesNotMatch(readiness, /VPS_WORKER_SSH_TARGET|\bssh\b/);
    assert.doesNotMatch(readiness, /continue-on-error:\s*true/);
    // Production latch reads fingerprint the installed dotenv, never a
    // runner export (job-level env reaches the check script's resolver).
    assert.match(readiness, /^ {4}env:\n {6}GIGL_ENV_FILE_AUTHORITATIVE: '1'/m);
    assert.match(migrations, /needs: \[vps-drain-readiness\]/);
    assert.match(migrations, /needs\.vps-drain-readiness\.result == 'success'/);
    // Production is mid-rollout (worker role LOGIN-capable until this PR's
    // later migrations apply), so the cron removal must never land while
    // the interim window is open: assert the NOLOGIN final state after
    // every apply, before anything downstream can proceed.
    assert.match(
      migrations,
      /run: \.github\/scripts\/verify-gigl-worker-final-state\.sh/
    );
    assert.ok(
      migrations.indexOf('Apply pending migrations via Management API') <
        migrations.indexOf('Verify GIGL worker least-privilege final state'),
      'final-state verification must run after migrations apply'
    );
  });

  it('smokes the live GIGL capability only after migrations apply', () => {
    const capability = jobBlock('gigl-worker-capability', 'deploy-production');

    assert.match(
      capability,
      /needs: \[changes, db-migrations, vps-drain-readiness\]/
    );
    assert.match(capability, /needs\.db-migrations\.result == 'success'/);
    assert.match(
      capability,
      /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/
    );
    // No dispatch exemption: always() runs the smoke even when the
    // changes job is skipped, and unset outputs fail closed.
    assert.match(capability, /if: always\(\) &&/);
    assert.doesNotMatch(
      capability,
      /github\.event_name != 'workflow_dispatch'/
    );
    // Tracking changes retain exact-SHA smoke. Unrelated changes may recover
    // an unusable latch only when the installed worker contents are equivalent.
    // The broad migrations output must not select the recovery path.
    assert.match(capability, /needs\.changes\.outputs\.tracking != 'false'/);
    assert.match(capability, /outputs\.installed_tracking_stale == 'false'/);
    assert.match(capability, /outputs\.manifest_drift == 'false'/);
    assert.doesNotMatch(capability, /outputs\.migrations/);
    // One helper holds the worker locks across verification, smoke and proof
    // persistence; separate workflow steps could race with a worker promotion.
    assert.match(
      capability,
      /run: bash vps-workers\/release\/run-as-worker\.sh \.github\/scripts\/refresh-gigl-cutover-latch\.sh/
    );
    assert.doesNotMatch(
      capability,
      /> "\$VPS_WORKER_REMOTE_DIR\/\.gigl-capability-smoke-ok"/
    );
    // Production smoke/identity is file-authoritative at the job level,
    // so a runner export can never certify one token while cron runs
    // another (the smoke entry sets the same mode for its filter).
    assert.match(
      capability,
      /^ {4}env:\n {6}GIGL_ENV_FILE_AUTHORITATIVE: '1'/m
    );
  });
});

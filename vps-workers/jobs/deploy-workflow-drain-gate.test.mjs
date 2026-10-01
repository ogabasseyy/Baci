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

describe('production cache-invalidation drain rollout gate', () => {
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
      /^\s+run: \.readiness-checkout\/vps-workers\/bin\/verify-gigl-direct-workers-installed\.sh --skip-live-smoke$/m
    );
    assert.doesNotMatch(readiness, /VPS_WORKER_SSH_TARGET|\bssh\b/);
    assert.doesNotMatch(readiness, /continue-on-error:\s*true/);
    assert.match(migrations, /needs: \[vps-drain-readiness\]/);
    assert.match(migrations, /needs\.vps-drain-readiness\.result == 'success'/);
  });

  it('smokes the live GIGL capability only after migrations apply', () => {
    const capability = jobBlock('gigl-worker-capability', 'deploy-production');

    assert.match(capability, /needs: \[db-migrations\]/);
    assert.match(capability, /needs\.db-migrations\.result == 'success'/);
    assert.match(
      capability,
      /BACI_WORKER_PROFILE=gigl-tracking BACI_WORKER_ENV="\$remote_dir\/\.env" "\$remote_dir\/bin\/verify-gigl-tracking-worker-capability\.sh"/
    );
  });

  it('keeps the web release behind migrations and prebuilt-only', () => {
    const deployment = workflow.slice(workflow.indexOf('  deploy-production:'));

    assert.match(deployment, /needs: \[[^\]]*db-migrations[^\]]*\]/);
    assert.match(deployment, /needs\.db-migrations\.result == 'success'/);
    assert.match(deployment, /needs: \[[^\]]*gigl-worker-capability[^\]]*\]/);
    assert.match(
      deployment,
      /needs\.gigl-worker-capability\.result == 'success'/
    );
    assert.match(deployment, /deploy --prebuilt --prod/);
    assert.doesNotMatch(deployment, /run-pinned-vercel\.sh deploy --prod/);
    assert.match(
      deployment,
      /inject-prebuilt-env-secret\.mjs GIGL_TRACKING_WORKER_TOKEN \.vercel\/\.env\.production\.local/
    );
    assert.match(deployment, /0\|false\|off\) echo 'GIGL is not enabled/);
    assert.doesNotMatch(deployment, /''\|0\|false\|off\)/);
  });
});

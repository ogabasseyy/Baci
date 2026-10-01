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
    assert.match(readiness, /needs: \[changes\]/);
    assert.match(
      readiness,
      /needs\.changes\.outputs\.tracking != 'false' \|\| needs\.changes\.outputs\.migrations != 'false'/
    );
    assert.doesNotMatch(readiness, /VPS_WORKER_SSH_TARGET|\bssh\b/);
    assert.doesNotMatch(readiness, /continue-on-error:\s*true/);
    assert.match(migrations, /needs: \[vps-drain-readiness\]/);
    assert.match(migrations, /needs\.vps-drain-readiness\.result == 'success'/);
  });

  it('smokes the live GIGL capability only after migrations apply', () => {
    const capability = jobBlock('gigl-worker-capability', 'deploy-production');

    assert.match(capability, /needs: \[changes, db-migrations\]/);
    assert.match(capability, /needs\.db-migrations\.result == 'success'/);
    assert.match(
      capability,
      /github\.event_name != 'workflow_dispatch'/
    );
    assert.match(
      capability,
      /needs\.changes\.outputs\.tracking != 'false' \|\| needs\.changes\.outputs\.migrations != 'false'/
    );
    assert.match(
      capability,
      /run: \.github\/scripts\/smoke-gigl-worker-capability\.sh/
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
    assert.match(
      deployment,
      /needs\.changes\.outputs\.tracking == 'false' && needs\.changes\.outputs\.migrations == 'false'/
    );
    assert.match(deployment, /deploy --prebuilt --prod/);
    assert.doesNotMatch(deployment, /run-pinned-vercel\.sh deploy --prod/);
    assert.match(
      deployment,
      /run: \.github\/scripts\/verify-gigl-fallback-token\.sh \.vercel\/\.env\.production\.local/
    );
  });

  it('scopes the tracking changeset to the worker, fallback, and wrapper paths', () => {
    const filter = readFileSync(
      join(workerRoot, '..', '.github', 'filters', 'deploy.yml'),
      'utf8'
    );
    const tracking = filter.slice(filter.indexOf('tracking:'));

    assert.match(tracking, /^  - 'vercel\.json'$/m);
    assert.match(tracking, /^  - 'vps-workers\/\*\*'$/m);
    assert.match(
      tracking,
      /^  - 'apps\/web\/src\/app\/api\/cron\/gigl-tracking\/\*\*'$/m
    );
    assert.match(
      tracking,
      /^  - 'supabase\/migrations\/\*gigl\*'$/m
    );
  });
});

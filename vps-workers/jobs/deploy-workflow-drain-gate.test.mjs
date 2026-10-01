import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
    // The cutover marker runs on every push (no changeset condition),
    // so an unrelated web push cannot deploy the cron removal while the
    // worker was never installed.
    assert.match(
      readiness,
      /^\s+run: \.readiness-checkout\/vps-workers\/bin\/verify-gigl-direct-workers-installed\.sh --cutover-marker$/m
    );
    assert.match(readiness, /needs: \[changes\]/);
    assert.match(readiness, /needs\.changes\.outputs\.tracking != 'false'/);
    assert.doesNotMatch(readiness, /outputs\.migrations/);
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
      /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/
    );
    // No dispatch exemption: always() runs the smoke even when the
    // changes job is skipped, and unset outputs fail closed.
    assert.match(capability, /if: always\(\) &&/);
    assert.doesNotMatch(
      capability,
      /github\.event_name != 'workflow_dispatch'/
    );
    // `tracking` only: the broad `migrations` output must never gate
    // the smoke, or unrelated migrations freeze on worker drift.
    assert.match(capability, /needs\.changes\.outputs\.tracking != 'false'/);
    assert.doesNotMatch(capability, /outputs\.migrations/);
    assert.match(
      capability,
      /run: \.github\/scripts\/smoke-gigl-worker-capability\.sh/
    );
    // The latch persists only after the smoke succeeds (same job, later
    // step): it proves live token+hook function for the gate's bypass.
    assert.match(capability, /Persist GIGL cutover latch/);
    assert.match(capability, /\.gigl-capability-smoke-ok/);
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
    // The tracking=false bypass additionally requires the cutover latch
    // (proven smoke function), so a web push after a smoke-failed tracking
    // push cannot deploy the cron removal with a broken worker.
    assert.match(
      deployment,
      /needs\.gigl-worker-capability\.result == 'success' \|\| \(needs\.changes\.outputs\.tracking == 'false' && needs\.vps-drain-readiness\.outputs\.cutover_latched == 'true'\)/
    );
    assert.doesNotMatch(
      deployment,
      /tracking == 'false' && needs\.changes\.outputs\.migrations == 'false'/
    );
    assert.match(deployment, /needs: \[[^\]]*vps-drain-readiness[^\]]*\]/);
    assert.match(deployment, /deploy --prebuilt --prod/);
    assert.doesNotMatch(deployment, /run-pinned-vercel\.sh deploy --prod/);
    assert.match(
      deployment,
      /run: \.github\/scripts\/verify-gigl-fallback-token\.sh \.vercel\/\.env\.production\.local/
    );
    // No dispatch exemption in the capability requirement: a dispatch
    // can never land the cron removal unverified. The only remaining
    // dispatch term is the pre-existing deploy-scope behavior.
    assert.doesNotMatch(
      deployment,
      /needs\.gigl-worker-capability\.result == 'success' \|\| github\.event_name/
    );
    assert.doesNotMatch(deployment, /bypasses the GIGL worker capability/);
    assert.match(
      deployment,
      /github\.event_name == 'workflow_dispatch' \|\| needs\.changes\.outputs\.web == 'true'/
    );
  });

  it('scopes the tracking changeset to the worker, fallback, and wrapper paths', () => {
    const filter = readFileSync(
      join(workerRoot, '..', '.github', 'filters', 'deploy.yml'),
      'utf8'
    );
    const tracking = filter.slice(filter.indexOf('tracking:'));

    assert.match(tracking, /^ {2}- 'vercel\.json'$/m);
    assert.match(tracking, /^ {2}- 'vps-workers\/deploy\.sh'$/m);
    assert.match(
      tracking,
      /^ {2}- 'vps-workers\/bin\/process-gigl-tracking\.sh'$/m
    );
    assert.match(tracking, /^ {2}- 'vps-workers\/bin\/run-web-script\.sh'$/m);
    assert.match(
      tracking,
      /^ {2}- 'vps-workers\/bin\/verify-gigl-direct-workers-installed\.sh'$/m
    );
    assert.match(
      tracking,
      /^ {2}- 'vps-workers\/bin\/verify-gigl-tracking-worker-capability\.sh'$/m
    );
    assert.match(
      tracking,
      /^ {2}- 'vps-workers\/jobs\/preflight-direct-web-workers\.mjs'$/m
    );
    assert.match(
      tracking,
      /^ {2}- 'vps-workers\/lib\/prepare-worker-release\.sh'$/m
    );
    assert.match(tracking, /^ {2}- 'vps-workers\/package\.json'$/m);
    assert.match(tracking, /^ {2}- 'vps-workers\/pnpm-lock\.yaml'$/m);
    assert.match(tracking, /^ {2}- 'vps-workers\/pnpm-workspace\.yaml'$/m);
    assert.match(
      tracking,
      /^ {2}- 'apps\/web\/src\/app\/api\/cron\/gigl-tracking\/\*\*'$/m
    );
    assert.match(tracking, /^ {2}- 'supabase\/migrations\/\*gigl\*'$/m);
    assert.match(
      tracking,
      /^ {2}- 'apps\/web\/src\/lib\/shipping\/providers\/gigl\*'$/m
    );
    assert.match(
      tracking,
      /^ {2}- 'apps\/web\/src\/lib\/shipping\/providers\/base\.ts'$/m
    );
    assert.match(
      tracking,
      /^ {2}- 'packages\/shared\/src\/lib\/gigl-tracking-status\.ts'$/m
    );
  });

  it('keeps every GIGL-named behavioral worker file in the tracking filter', () => {
    // Explicit paths (no vps-workers/** glob) risk silent under-triggering
    // when GIGL worker files are added, so every gigl/tracking-named
    // behavioral file must appear in the filter. Non-behavioral matches
    // (tests, docs, runtime dirs) and the non-tracking GIGL directory
    // sync (no worker token) are excluded by design.
    const filter = readFileSync(
      join(workerRoot, '..', '.github', 'filters', 'deploy.yml'),
      'utf8'
    );
    const tracking = filter.slice(
      filter.indexOf('tracking:'),
      filter.indexOf('migrations:')
    );

    assert.doesNotMatch(tracking, /^ {2}- 'vps-workers\/\*\*'$/m);

    const excluded = new Set([
      'jobs/sync-gigl-service-centres.mjs',
      'jobs/sync-gigl-service-centres.test.mjs',
    ]);
    const entries = readdirSync(workerRoot, { recursive: true });
    const discovered = entries.filter(
      (entry) =>
        /gigl|tracking/i.test(entry) &&
        !/\.test\./.test(entry) &&
        !entry.startsWith('docs/') &&
        !entry.startsWith('logs/') &&
        !entry.startsWith('locks/') &&
        !excluded.has(entry)
    );

    assert.ok(
      discovered.length > 0,
      'expected GIGL-named worker files to exist'
    );
    for (const entry of discovered) {
      assert.match(
        tracking,
        new RegExp(
          `^  - 'vps-workers/${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`,
          'm'
        ),
        `tracking filter omits vps-workers/${entry}`
      );
    }
  });
});

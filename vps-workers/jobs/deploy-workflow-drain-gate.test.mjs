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
  it('runs migrations on manual dispatch after successful readiness despite skipped changes', () => {
    const migrations = jobBlock('db-migrations', 'gigl-worker-capability');
    // Without an explicit status function, Actions adds success() across
    // the dependency chain. The skipped changes ancestor then skips this
    // job even after the always()-guarded readiness job succeeds.
    assert.match(
      migrations,
      /^ {4}if: always\(\) && github\.ref == 'refs\/heads\/main' && needs\.vps-drain-readiness\.result == 'success'$/m
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
    // The tracking=false bypass additionally requires the cutover latch
    // (proven smoke function) at a revision that still covers the tree,
    // so a web push cannot carry unsmoked tracking changes to production.
    // It also requires manifest_drift == 'false': the poller executes
    // the manifests-group dependency tree, so a manifest-only push must
    // not bypass while the installed tree predates HEAD's manifests.
    assert.match(
      deployment,
      /needs\.gigl-worker-capability\.result == 'success' \|\| \(needs\.changes\.outputs\.tracking == 'false' && needs\.vps-drain-readiness\.outputs\.cutover_latched == 'true' && needs\.vps-drain-readiness\.outputs\.tracking_stale == 'false' && needs\.vps-drain-readiness\.outputs\.manifest_drift == 'false'\)/
    );
    assert.doesNotMatch(
      deployment,
      /tracking == 'false' && needs\.changes\.outputs\.migrations == 'false'/
    );
    assert.match(deployment, /needs: \[[^\]]*vps-drain-readiness[^\]]*\]/);
    // The pre-publish overlap check is the correctness backstop for
    // the deploy.sh serialization: it must run the script immediately
    // before the publish. The script reads the ops-branch record via
    // the contents API, so no permission beyond contents:read is
    // needed (GITHUB_TOKEN cannot be granted Variables).
    assert.match(
      deployment,
      /run: \.github\/scripts\/refuse-publish-on-promote-overlap\.sh/
    );
    assert.ok(
      deployment.indexOf('refuse-publish-on-promote-overlap.sh') <
        deployment.indexOf('Deploy to Vercel (with retry)')
    );
    const publishCommand = deployment
      .split('\n')
      .find((line) =>
        line
          .trimStart()
          .startsWith('run: .github/scripts/deploy-with-retry.sh ')
      );
    assert.ok(publishCommand, 'missing prebuilt publication command');
    const publishArgs = publishCommand.trim().split(/\s+/);
    assert.ok(publishArgs.includes('deploy'));
    assert.ok(publishArgs.includes('--prebuilt'));
    assert.ok(publishArgs.includes('--prod'));
    assert.ok(publishArgs.includes('--skip-domain'));
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
      /^ {2}- 'apps\/web\/src\/app\/api\/cron\/gigl-tracking\/run-gigl-tracking-monitor-batch\.ts'$/m
    );
    assert.match(
      tracking,
      /^ {2}- 'apps\/web\/src\/app\/api\/cron\/gigl-tracking\/gigl-tracking-monitor-worker\.ts'$/m
    );
    assert.match(
      tracking,
      /^ {2}- 'apps\/web\/src\/app\/api\/cron\/gigl-tracking\/nullable-supabase-rpc-argument\.ts'$/m
    );
    // No recursive glob: notification-only fixes must not demand a
    // poller rollout (completeness is pinned by the graph test).
    assert.doesNotMatch(
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
    // The shipped dotenv reader is a runtime dependency of every poll.
    assert.match(tracking, /^ {2}- '\.github\/scripts\/gigl-dotenv\.sh'$/m);
  });

  it('keeps every GIGL-named behavioral worker file in the tracking filter', () => {
    // Explicit paths (no vps-workers/** glob) risk silent under-triggering
    // when GIGL worker files are added, so every gigl/tracking-named
    // behavioral file must appear in the filter. Non-behavioral matches
    // (tests, shared test fixtures, docs, runtime dirs) and the
    // non-tracking GIGL directory sync (no worker token) are excluded
    // by design.
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
        !/\.test[.-]/.test(entry) &&
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

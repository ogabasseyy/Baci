import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const workflow = (name) => YAML.parse(readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8'));

test('only the trusted coordinator accepts main pushes and manual release dispatches', () => {
  const coordinator = workflow('production-release.yml');
  assert.deepEqual(coordinator.on.push.branches, ['main']);
  assert.ok(coordinator.on.workflow_dispatch);
  assert.equal(coordinator.concurrency['cancel-in-progress'], false);
  assert.match(coordinator.concurrency.group, /production-release/);
  assert.deepEqual(coordinator.jobs.workers.needs, ['rollout-readiness']);
  assert.match(coordinator.jobs.workers.if, /needs\.rollout-readiness\.result == 'success'/);
  const readiness = coordinator.jobs['rollout-readiness'];
  const readinessStep = readiness.steps[0].run;
  for (const [variable, envName] of [
    ['BACI_WORKER_RELEASE_BROKER_READY', 'BROKER_READY'],
    ['BACI_WORKER_RELEASE_CREDENTIAL_ISOLATION_READY', 'CREDENTIAL_ISOLATION_READY'],
    ['BACI_WORKER_RELEASE_QUIESCENCE_READY', 'QUIESCENCE_READY'],
    ['BACI_WORKER_RELEASE_SERVICE_COMPATIBILITY_READY', 'SERVICE_COMPATIBILITY_READY'],
  ]) {
    assert.match(readiness.env[envName], new RegExp(`vars\\.${variable}`));
    assert.ok(readinessStep.includes(envName), `rollout gate must check ${variable}`);
  }
  assert.match(readinessStep, /!= 'true'/);
  assert.match(readinessStep, /exit 1/);
  assert.equal(coordinator.jobs.workers['runs-on'], 'baci-release');
  assert.equal(coordinator.jobs.workers['timeout-minutes'], 60);
  assert.equal(coordinator.jobs['release-lock-finalizer']['runs-on'], 'baci-release');
  assert.equal(coordinator.jobs.deploy.uses, './.github/workflows/deploy.yml');
  assert.deepEqual(coordinator.jobs.deploy.needs, ['workers']);
  assert.deepEqual(coordinator.jobs['release-lock-finalizer'].needs, ['deploy']);
  const deploy = workflow('deploy.yml');
  for (const job of ['vps-drain-readiness', 'gigl-worker-capability', 'cache-worker-management', 'cache-invalidation-worker-capability', 'deploy-production']) {
    assert.equal(deploy.jobs[job]['runs-on'], 'baci-release');
  }
});

test('cache worker capability is proven after migrations and is mandatory before app publication', () => {
  const deploy = workflow('deploy.yml');
  const coordinator = workflow('production-release.yml');
  assert.deepEqual(coordinator.on.workflow_dispatch.inputs.cache_worker_action.options, ['none', 'activate']);
  assert.equal(coordinator.on.workflow_dispatch.inputs.cache_worker_action.default, 'none');
  assert.equal(coordinator.jobs.deploy.with.cache_worker_action, "${{ inputs.cache_worker_action || 'none' }}");

  const management = deploy.jobs['cache-worker-management'];
  assert.deepEqual(management.needs, ['changes', 'db-migrations']);
  assert.match(management.if, /needs\.db-migrations\.result == 'success'/);
  assert.equal(management.name, 'Manage cache worker capability');
  assert.equal(management.environment, 'production');
  assert.equal(management.permissions['id-token'], 'write');
  assert.ok(management.steps.some((step) => step.run === 'node .github/scripts/production-release-lock.mjs authorize-cache-worker-action'));
  const mutation = management.steps.find((step) => step.name === 'Apply explicitly approved membership action');
  assert.equal(mutation.if, "env.CACHE_WORKER_ACTION != 'none'");
  assert.equal(mutation.env.SUPABASE_ACCESS_TOKEN, '${{ secrets.SUPABASE_ACCESS_TOKEN }}');
  assert.equal(mutation.env.CACHE_INVALIDATION_WORKER_TOKEN, '${{ secrets.CACHE_INVALIDATION_WORKER_TOKEN }}');
  assert.equal(mutation.run, 'bash .github/scripts/cache-invalidation-worker-activation.sh "$CACHE_WORKER_ACTION"');
  const envSync = management.steps.find((step) => step.name === 'Synchronize the restricted worker token to Vercel Production');
  const actionValidation = management.steps.find((step) => step.name === 'Reject unsupported cache worker actions before secret sync');
  assert.ok(actionValidation);
  assert.ok(management.steps.indexOf(actionValidation) < management.steps.indexOf(envSync));
  assert.match(actionValidation.run, /none\|activate/);
  assert.equal(envSync.env.CACHE_INVALIDATION_WORKER_TOKEN, '${{ secrets.CACHE_INVALIDATION_WORKER_TOKEN }}');
  assert.equal(envSync.env.VERCEL_TOKEN, '${{ secrets.VERCEL_TOKEN }}');
  assert.equal(envSync.run, 'node .github/scripts/sync-cache-worker-vercel-env.mjs');
  assert.ok(management.steps.some((step) => step.name === 'Remove pulled secret-bearing Vercel environment files' && step.if === 'always()'));

  const probe = deploy.jobs['cache-invalidation-worker-capability'];
  assert.deepEqual(probe.needs, ['changes', 'db-migrations', 'cache-worker-management']);
  assert.match(probe.if, /needs\.db-migrations\.result == 'success'/);
  assert.match(probe.if, /needs\.cache-worker-management\.result == 'success'/);
  assert.equal(probe.environment, 'production');
  assert.equal(probe['timeout-minutes'], 20);
  assert.equal(probe.permissions.contents, 'read');
  assert.equal(probe.env.CACHE_INVALIDATION_WORKER_TOKEN, '${{ secrets.CACHE_INVALIDATION_WORKER_TOKEN }}');
  assert.ok(probe.steps.some((step) => step.run === 'bash .github/scripts/probe-cache-invalidation-worker-capability.sh'));
  assert.equal(probe.steps.find((step) => step.uses)?.with['persist-credentials'], false);

  const publication = deploy.jobs['deploy-production'];
  assert.ok(publication.needs.includes('cache-invalidation-worker-capability'));
  assert.match(publication.if, /needs\.cache-invalidation-worker-capability\.result == 'success'/);
  assert.match(readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8'), /activation must complete under the[\s\S]*lock above/);
  const publishStep = publication.steps.find((step) => step.name === 'Deploy to Vercel (with retry)');
  assert.equal(publishStep.env.DEPLOY_POST_PROMOTE_HEALTH_CHECK, '.github/scripts/probe-live-cache-invalidation-worker-route.sh');
  assert.equal(publishStep.env.CRON_SECRET, '${{ secrets.CRON_SECRET }}');
});

test('the app workflow is callable only and refuses a bare direct publication path', () => {
  const deploy = workflow('deploy.yml');
  assert.ok(deploy.on.workflow_call);
  assert.ok(deploy.on.workflow_call.outputs.production_published);
  assert.equal(deploy.on.push, undefined);
  assert.equal(deploy.on.workflow_dispatch, undefined);
  assert.ok(deploy.jobs['deploy-production'].if.includes('inputs.expected_release_sha'));
  assert.ok(deploy.jobs['deploy-production'].steps.some((step) => step.name === 'Verify live production alias and release lock'));
  assert.match(deploy.jobs['deploy-production'].outputs.production_published, /live-alias-verification\.outcome/);
});

test('worker exemption requires the OIDC verifier and exact run-bound check run', () => {
  const deploy = readFileSync(new URL('../../vps-workers/lib/check-deploy-workflow-inflight.sh', import.meta.url), 'utf8');
  assert.match(deploy, /authorize-coordinator-worker\.mjs/);
  const authorizer = readFileSync(new URL('./authorize-coordinator-worker.mjs', import.meta.url), 'utf8');
  assert.match(authorizer, /check_run_id/);
  assert.match(authorizer, /run_attempt/);
  assert.match(authorizer, /runner_name/);
  assert.match(authorizer, /current main/);
  assert.doesNotMatch(deploy, /BACI_DEPLOY_SKIP_INFLIGHT_CHECK/);
});

test('a sticky release lock is acquired before broker promotion and only cleared by verified success', () => {
  const coordinator = readFileSync(new URL('../workflows/production-release.yml', import.meta.url), 'utf8');
  assert.match(coordinator, /production-release-lock\.mjs acquire/);
  assert.ok(coordinator.indexOf('production-release-lock.mjs acquire') < coordinator.indexOf('worker-release-coordinator.mjs'));
  assert.match(coordinator, /worker-release-coordinator\.mjs/);
  assert.doesNotMatch(coordinator, /vps-workers\/deploy\.sh/);
  assert.match(coordinator, /persist-credentials: false/);
  const workerCoordinator = readFileSync(new URL('./worker-release-coordinator.mjs', import.meta.url), 'utf8');
  assert.match(workerCoordinator, /state !== 'worker_syncing'/);
  assert.match(workerCoordinator, /health\.sourceSha !== identity\.sha/);
  assert.match(workerCoordinator, /persistent release lock remains held/);
  assert.match(coordinator, /production-release-lock\.mjs clear-noop/);
  assert.match(coordinator, /needs\.deploy\.result == 'success'/);
  assert.match(coordinator, /needs\.deploy\.outputs\.production_published != 'true'/);
  const deploy = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(deploy, /production-release-lock\.mjs verify-publishing/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import YAML from 'yaml';

const workflow = YAML.parse(
  readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8')
);
const capability = workflow.jobs['gigl-worker-capability'];
const publication = workflow.jobs['deploy-production'];
const installedSha = '1'.repeat(40);
const workflowSha = '2'.repeat(40);

// Evaluate the checked-in Actions expressions, rather than reproducing their
// conditions in the test. These expressions use only boolean operators,
// string comparisons, context properties and always(). Missing outputs are
// represented by empty strings, as they are for a skipped changes job.
function evaluate(expression, context) {
  assert.equal(typeof expression, 'string');
  const source = expression
    .replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, '$1')
    .replace(/\bneeds\.([\w-]+)/g, 'needs["$1"]');
  return runInNewContext(
    source,
    { ...context, always: () => true },
    { timeout: 1000 }
  );
}

function fixture({
  tracking = 'false',
  latch = 'false',
  stale = 'true',
  installedStale = 'false',
  manifests = 'false',
  readiness = 'success',
  migrations = 'success',
  smoke = 'skipped',
  event = 'push',
  ref = 'refs/heads/main',
} = {}) {
  return {
    github: { event_name: event, ref, sha: workflowSha },
    needs: {
      changes: {
        result: event === 'workflow_dispatch' ? 'skipped' : 'success',
        outputs: { tracking, web: 'true', migrations: 'false' },
      },
      'vps-drain-readiness': {
        result: readiness,
        outputs: {
          cutover_latched: latch,
          tracking_stale: stale,
          installed_sha: installedSha,
          installed_tracking_stale: installedStale,
          manifest_drift: manifests,
        },
      },
      'db-migrations': { result: migrations },
      'gigl-worker-capability': { result: smoke },
      'cwv-runner-contracts': { result: 'skipped' },
    },
  };
}

function expectedWorkerSha(context) {
  const refresh = capability.steps.find(
    (step) => step.run === 'bash .github/scripts/refresh-gigl-cutover-latch.sh'
  );
  assert.ok(refresh, 'the capability job must use the locked refresh helper');
  return evaluate(refresh.env.BACI_EXPECTED_APP_SHA, context);
}

test('re-smokes an equivalent promoted worker after migrations instead of silently skipping publication', () => {
  const context = fixture();
  assert.equal(evaluate(capability.if, context), true);
  assert.equal(expectedWorkerSha(context), installedSha);
  assert.equal(evaluate(publication.if, context), false);

  context.needs['gigl-worker-capability'].result = 'success';
  assert.equal(evaluate(publication.if, context), true);
});

test('recovers an unusable latch freshness check when installed contents are proven equivalent', () => {
  const context = fixture({ latch: 'true', stale: 'true' });
  assert.equal(evaluate(capability.if, context), true);
  assert.equal(expectedWorkerSha(context), installedSha);
});

test('keeps a proven unchanged worker on the existing no-smoke path', () => {
  const context = fixture({ latch: 'true', stale: 'false' });
  assert.equal(evaluate(capability.if, context), false);
  assert.equal(evaluate(publication.if, context), true);
});

test('does not recover when installed tracking or dependency equivalence is unknown or false', () => {
  for (const overrides of [
    { installedStale: 'true' },
    { installedStale: '' },
    { manifests: 'true' },
    { manifests: '' },
  ]) {
    const context = fixture(overrides);
    assert.equal(
      evaluate(capability.if, context),
      false,
      JSON.stringify(overrides)
    );
    assert.equal(
      evaluate(publication.if, context),
      false,
      JSON.stringify(overrides)
    );
  }
});

test('requires successful readiness and migrations before any recovery smoke', () => {
  assert.ok(capability.needs.includes('vps-drain-readiness'));
  for (const result of ['failure', 'skipped', 'cancelled', '']) {
    for (const key of ['readiness', 'migrations']) {
      const context = fixture({ [key]: result });
      assert.equal(
        evaluate(capability.if, context),
        false,
        `${key}: ${result}`
      );
    }
  }
  assert.equal(
    evaluate(capability.if, fixture({ ref: 'refs/heads/feature' })),
    false
  );
});

test('tracking changes and manual or unknown changesets still require the exact workflow SHA', () => {
  for (const overrides of [
    { tracking: 'true' },
    { tracking: '' },
    { tracking: '', event: 'workflow_dispatch' },
  ]) {
    const context = fixture({
      ...overrides,
      installedStale: 'true',
      manifests: 'true',
    });
    assert.equal(
      evaluate(capability.if, context),
      true,
      JSON.stringify(overrides)
    );
    assert.equal(
      expectedWorkerSha(context),
      workflowSha,
      JSON.stringify(overrides)
    );
  }
});

test('a failed or skipped recovery cannot authorize publication', () => {
  for (const smoke of ['failure', 'skipped', 'cancelled', '']) {
    assert.equal(evaluate(publication.if, fixture({ smoke })), false, smoke);
  }
});

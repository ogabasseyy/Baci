import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('./check-production-release-outcome.mjs', import.meta.url)
);

function releaseNeeds() {
  return {
    changes: {
      result: 'success',
      outputs: { web: 'true', migrations: 'true', tracking: 'false' },
    },
    'vps-drain-readiness': {
      result: 'success',
      outputs: {
        cutover_latched: 'false',
        tracking_stale: 'true',
        manifest_drift: 'true',
      },
    },
    'db-migrations': { result: 'success', outputs: {} },
    'gigl-worker-capability': { result: 'skipped', outputs: {} },
    'cwv-runner-contracts': { result: 'skipped', outputs: {} },
    'deploy-production': { result: 'skipped', outputs: {} },
  };
}

function check(t, needs, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'production-release-outcome-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summaryPath = join(dir, 'summary.md');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_STEP_SUMMARY: summaryPath,
      RELEASE_NEEDS_JSON: JSON.stringify(needs),
      ...env,
    },
  });
  let summary = '';
  try {
    summary = readFileSync(summaryPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { ...result, summary };
}

test('fails a required release when stale worker proof silently skipped publication', (t) => {
  const result = check(t, releaseNeeds());
  assert.equal(result.status, 1);
  for (const output of [result.stderr, result.summary]) {
    assert.match(
      output,
      /Production publication required but deploy-production is skipped/
    );
    assert.match(output, /cutover_latched: false/);
    assert.match(output, /tracking_stale: true/);
    assert.match(output, /gigl-worker-capability: skipped/);
  }
});

test('accepts a completed required deployment', (t) => {
  const needs = releaseNeeds();
  needs['deploy-production'].result = 'success';
  const result = check(t, needs);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.summary, /Production publication completed/);
});

for (const result of ['failure', 'cancelled']) {
  test(`fails required publication when deploy-production is ${result}`, (t) => {
    const needs = releaseNeeds();
    needs['deploy-production'].result = result;
    const checked = check(t, needs);
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, new RegExp(`deploy-production is ${result}`));
  });
}

test('accepts an intentional docs-only skip', (t) => {
  const needs = releaseNeeds();
  needs.changes.outputs = {
    web: 'false',
    migrations: 'false',
    tracking: 'false',
  };
  const result = check(t, needs);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.summary, /Production publication not required/);
});

test('requires publication for migrations-only changes', (t) => {
  const needs = releaseNeeds();
  needs.changes.outputs.web = 'false';
  const result = check(t, needs);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production publication required/);
});

for (const deploymentResult of ['skipped', 'success']) {
  test(`manual dispatch requires publication with changes skipped and deployment ${deploymentResult}`, (t) => {
    const needs = releaseNeeds();
    needs.changes = { result: 'skipped', outputs: {} };
    needs['deploy-production'].result = deploymentResult;
    const result = check(t, needs, { GITHUB_EVENT_NAME: 'workflow_dispatch' });
    assert.equal(result.status, deploymentResult === 'success' ? 0 : 1);
    assert.match(result.summary, /Production publication/);
  });
}

for (const changesResult of ['failure', 'cancelled', 'skipped']) {
  test(`fails closed when a main push cannot establish scope because changes is ${changesResult}`, (t) => {
    const needs = releaseNeeds();
    needs.changes = { result: changesResult, outputs: {} };
    const result = check(t, needs);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot determine production release scope/);
  });
}

test('fails closed when a successful changes job omits required scope outputs', (t) => {
  const needs = releaseNeeds();
  needs.changes.outputs = {};
  const result = check(t, needs);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot determine production release scope/);
});

test('rejects malformed results without echoing input or credentials', (t) => {
  const secret = 'super-secret-fixture-value';
  const malformed = check(t, {}, { RELEASE_NEEDS_JSON: secret });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Invalid production release results/);
  assert.doesNotMatch(malformed.stderr + malformed.summary, new RegExp(secret));

  const needs = releaseNeeds();
  needs['deploy-production'].result = secret;
  needs['vps-drain-readiness'].outputs.cutover_latched = secret;
  needs['vps-drain-readiness'].outputs.credential_fingerprint = secret;
  needs[secret] = { result: secret };
  const unsafe = check(t, needs);
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /deploy-production is unknown/);
  assert.doesNotMatch(unsafe.stderr + unsafe.summary, new RegExp(secret));
});

test('does not apply the production outcome check to other branches', (t) => {
  const result = check(t, {}, { GITHUB_REF: 'refs/heads/feature' });
  assert.equal(result.status, 0, result.stderr);
});

test('workflow waits for terminal job results and invokes the outcome check without secrets', async () => {
  const { default: YAML } = await import('yaml');
  const workflow = YAML.parse(
    readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8')
  );
  const job = workflow.jobs['production-release-outcome'];
  assert.ok(job, 'Missing final publication outcome job');
  assert.match(job.if, /always\(\)/);
  assert.match(job.if, /refs\/heads\/main/);
  assert.deepEqual(new Set(job.needs), new Set(Object.keys(releaseNeeds())));
  assert.equal(job.permissions.contents, 'read');
  const step = job.steps.find((item) =>
    item.run?.includes('check-production-release-outcome.mjs')
  );
  assert.ok(step, 'Outcome script is not invoked');
  assert.equal(step.env.RELEASE_NEEDS_JSON, '${{ toJSON(needs) }}');
  assert.doesNotMatch(JSON.stringify(job), /secrets\./);
  assert.notEqual(job['continue-on-error'], true);
  assert.notEqual(step['continue-on-error'], true);
});

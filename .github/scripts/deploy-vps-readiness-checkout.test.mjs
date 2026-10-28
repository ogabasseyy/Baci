import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { assertNoopPublicationOutcome } from './production-release-lock.mjs';

const deploymentWorkflowUrl = new URL('../workflows/deploy.yml', import.meta.url);
const coordinatorWorkflowUrl = new URL('../workflows/production-release.yml', import.meta.url);

function evaluateGithubExpression(expression, context) {
  const source = expression
    .replace(/^\s*\$\{\{\s*/, '')
    .replace(/\s*\}\}\s*$/, '')
    .trim();
  const tokenPattern = /\s*(\&\&|\|\||==|!=|!|\(|\)|'[^']*'|[A-Za-z_][A-Za-z0-9_.-]*)/y;
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(source);
    if (!match) throw new Error(`Unsupported workflow expression at ${source.slice(offset)}`);
    tokens.push(match[1]);
    offset = tokenPattern.lastIndex;
  }

  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = (expected) => {
    const token = tokens[cursor++];
    if (expected !== undefined && token !== expected) {
      throw new Error(`Expected ${expected}, received ${token}`);
    }
    return token;
  };
  const resolve = (name) => {
    if (name === 'true') return true;
    if (name === 'false') return false;
    return name.split('.').reduce((value, key) => value?.[key], context);
  };

  function primary() {
    if (peek() === '(') {
      take('(');
      const value = disjunction();
      take(')');
      return value;
    }
    const token = take();
    if (token?.startsWith("'")) return token.slice(1, -1);
    if (peek() === '(') {
      take('(');
      take(')');
      if (token === 'always' || token === 'success') return true;
      throw new Error(`Unsupported workflow function ${token}`);
    }
    return resolve(token);
  }

  function negation() {
    if (peek() === '!') {
      take('!');
      return !negation();
    }
    return primary();
  }

  function equality() {
    let value = negation();
    while (peek() === '==' || peek() === '!=') {
      const operator = take();
      const right = negation();
      value = operator === '==' ? value === right : value !== right;
    }
    return value;
  }

  function conjunction() {
    let value = equality();
    while (peek() === '&&') {
      take('&&');
      const right = equality();
      value = value ? right : value;
    }
    return value;
  }

  function disjunction() {
    let value = conjunction();
    while (peek() === '||') {
      take('||');
      const right = conjunction();
      value = value ? value : right;
    }
    return value;
  }

  const result = disjunction();
  if (cursor !== tokens.length) throw new Error(`Unexpected workflow token ${peek()}`);
  return result;
}

test('validates publication tooling and safety before building and again before publishing', async () => {
  const workflow = YAML.parse(await readFile(deploymentWorkflowUrl, 'utf8'));
  const steps = workflow.jobs['deploy-production'].steps;
  const buildIndex = steps.findIndex((step) => step.name === 'Build for Vercel');
  const publishIndex = steps.findIndex((step) => step.name === 'Deploy to Vercel (with retry)');
  const checks = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.run === '.github/scripts/refuse-publish-on-promote-overlap.sh');
  assert.equal(checks.length, 2);
  assert.ok(checks[0].index < buildIndex);
  assert.ok(checks[1].index > buildIndex && checks[1].index < publishIndex);
  for (const { step } of checks) {
    assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
    assert.equal(step['continue-on-error'], undefined);
  }
});

test('uses a minimal sparse checkout for exact-SHA worker readiness', async () => {
  const workflow = YAML.parse(await readFile(deploymentWorkflowUrl, 'utf8'));
  const readiness = workflow.jobs['vps-drain-readiness'];
  const checkout = readiness.steps.find((step) => typeof step.uses === 'string');

  assert.equal(checkout.with.path, '.readiness-checkout');
  assert.equal(
    checkout.with['sparse-checkout'],
    '.github/scripts/check-worker-release-readiness.mjs\n' +
      '.github/scripts/verify-coordinated-release.sh\n' +
      'vps-workers/lib/worker-release-broker-client.mjs\n'
  );
  assert.equal(checkout.with['sparse-checkout-cone-mode'], false);
  assert.equal(
    readiness.steps.find((step) => step.id === 'worker-readiness').run,
    'node .readiness-checkout/.github/scripts/check-worker-release-readiness.mjs'
  );
  assert.deepEqual(Object.keys(readiness.outputs).sort(), ['installed_sha', 'worker_units_ready']);
  assert.equal(readiness.steps.some((step) => step.run?.includes('/home/bassey/')), false);
});

test('keeps the post-migration capability smoke bound to the caller SHA', async () => {
  const workflow = YAML.parse(await readFile(deploymentWorkflowUrl, 'utf8'));
  const readiness = workflow.jobs['vps-drain-readiness'];
  const capability = workflow.jobs['gigl-worker-capability'];
  const smoke = capability.steps.find(
    (step) => step.run === 'node .github/scripts/run-gigl-capability-smoke.mjs'
  );

  assert.ok(smoke);
  assert.equal(smoke.env.BACI_EXPECTED_APP_SHA, '${{ github.sha }}');
  assert.deepEqual(capability.needs, ['changes', 'db-migrations', 'vps-drain-readiness']);
  assert.match(capability.if, /always\(\)/);
  assert.match(capability.if, /needs\.db-migrations\.result == 'success'/);
  assert.match(capability.if, /needs\.vps-drain-readiness\.result == 'success'/);
  assert.equal(capability.permissions['id-token'], 'write');
  assert.equal(capability.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(
    readiness.steps.find((step) => step.id === 'worker-readiness').env,
    undefined,
    'readiness receives the exact SHA from the job environment'
  );
  assert.equal(
    readiness.env.BACI_EXPECTED_APP_SHA,
    '${{ github.sha }}'
  );
});

test('clears the persistent lock only for a successful no-op, and preserves published or failed outcomes', async () => {
  const deployment = YAML.parse(await readFile(deploymentWorkflowUrl, 'utf8'));
  const coordinator = YAML.parse(await readFile(coordinatorWorkflowUrl, 'utf8'));
  const publishJob = deployment.jobs['deploy-production'];
  const finalizer = coordinator.jobs['release-lock-finalizer'];

  const publishedExpression = publishJob.outputs.production_published;
  const publicationOutcome = (stepOutcome) =>
    evaluateGithubExpression(publishedExpression, {
      steps: { 'live-alias-verification': { outcome: stepOutcome } },
    });
  assert.equal(publicationOutcome('success'), 'true');
  assert.equal(publicationOutcome('skipped'), 'false');
  assert.equal(publicationOutcome('failure'), 'false');

  const finalizerRuns = (deployResult, published) =>
    Boolean(
      evaluateGithubExpression(finalizer.if, {
        needs: {
          deploy: {
            result: deployResult,
            outputs: { production_published: published },
          },
        },
      })
    );
  assert.equal(finalizer.needs.join(','), 'deploy');
  assert.equal(finalizerRuns('success', 'false'), true);
  assert.equal(finalizerRuns('success', 'true'), false);
  assert.equal(finalizerRuns('failure', 'false'), false);
  assert.equal(finalizerRuns('skipped', 'false'), false);
  assert.equal(
    finalizer.env.BACI_APP_PUBLICATION_SUCCEEDED,
    "${{ needs.deploy.outputs.production_published || 'false' }}"
  );
  assert.equal(
    finalizer.steps.find((step) => step.name === 'Clear only when the app workflow proves no publication was attempted').run,
    'node .github/scripts/production-release-lock.mjs clear-noop'
  );

  assertNoopPublicationOutcome('false');
  assert.throws(
    () => assertNoopPublicationOutcome('true'),
    /did not prove that app publication was skipped/
  );
});

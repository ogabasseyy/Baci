import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import { runGiglCapabilitySmoke } from './run-gigl-capability-smoke.mjs';

const deploymentWorkflow = YAML.parse(
  readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8')
);
const coordinatorWorkflow = YAML.parse(
  readFileSync(new URL('../workflows/production-release.yml', import.meta.url), 'utf8')
);
const publication = deploymentWorkflow.jobs['deploy-production'];
const releaseSha = 'a'.repeat(40);

function manualContext(overrides = {}) {
  return {
    github: {
      ref: 'refs/heads/main',
      event_name: 'workflow_dispatch',
      sha: releaseSha,
    },
    inputs: { expected_release_sha: releaseSha },
    needs: {
      changes: { result: 'skipped', outputs: {} },
      'vps-drain-readiness': { result: 'success' },
      'db-migrations': { result: 'success' },
      'gigl-worker-capability': { result: 'success' },
      'cache-worker-management': { result: 'success' },
      'cache-invalidation-worker-capability': { result: 'success' },
      'cwv-runner-contracts': { result: 'skipped' },
      ...overrides,
    },
  };
}

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
      if (token === 'always') return true;
      if (token === 'success') return true;
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

function publicationRuns(context) {
  return Boolean(evaluateGithubExpression(publication.if, context));
}

test('manual coordinator dispatch reaches publication only after all current-run gates', () => {
  const manualInput = coordinatorWorkflow.on.workflow_dispatch;
  assert.ok(manualInput, 'the production coordinator must accept manual dispatches');
  assert.equal(
    coordinatorWorkflow.jobs.workers.env.BACI_EXPECTED_APP_SHA,
    '${{ github.sha }}'
  );
  assert.equal(
    evaluateGithubExpression(coordinatorWorkflow.jobs.workers.if, {
      github: { ref: 'refs/heads/main', event_name: 'workflow_dispatch' },
      needs: { 'rollout-readiness': { result: 'success' } },
    }),
    true,
    'manual coordinator runs still pass rollout readiness before worker sync'
  );
  const coordinatorDeploy = coordinatorWorkflow.jobs.deploy;
  assert.deepEqual(coordinatorDeploy.needs, ['workers']);
  assert.equal(coordinatorDeploy.with.expected_release_sha, '${{ github.sha }}');
  assert.equal(
    evaluateGithubExpression(coordinatorDeploy.if, {
      needs: { workers: { result: 'success' } },
    }),
    true
  );
  assert.equal(
    evaluateGithubExpression(coordinatorDeploy.if, {
      needs: { workers: { result: 'failure' } },
    }),
    false,
    'the reusable app workflow waits for brokered worker success'
  );

  const context = manualContext();
  assert.equal(
    evaluateGithubExpression(deploymentWorkflow.jobs.changes.if, context),
    false,
    'manual dispatch skips path filtering'
  );
  assert.equal(
    evaluateGithubExpression(deploymentWorkflow.jobs['db-migrations'].if, context),
    true,
    'migrations still run after successful exact-SHA readiness'
  );
  assert.equal(
    evaluateGithubExpression(deploymentWorkflow.jobs['gigl-worker-capability'].if, context),
    true,
    'the broker smoke still runs when changes are skipped'
  );
  assert.equal(
    evaluateGithubExpression(deploymentWorkflow.jobs['cache-worker-management'].if, context),
    true,
    'manual dispatch selects cache-worker management even without path outputs'
  );
  assert.equal(
    evaluateGithubExpression(
      deploymentWorkflow.jobs['cache-invalidation-worker-capability'].if,
      context
    ),
    true,
    'the cache capability probe follows successful management and migrations'
  );
  assert.equal(publicationRuns(context), true);
});

test('missing, failed, skipped, or mismatched exact-SHA smoke blocks publication', async () => {
  for (const smokeResult of ['failure', 'skipped', undefined]) {
    const context = manualContext();
    if (smokeResult === undefined) delete context.needs['gigl-worker-capability'];
    else context.needs['gigl-worker-capability'] = { result: smokeResult };
    assert.equal(
      publicationRuns(context),
      false,
      `publication must block when smoke result is ${smokeResult ?? 'missing'}`
    );
  }

  const wrongSha = 'b'.repeat(40);
  await assert.rejects(
    runGiglCapabilitySmoke({
      env: { BACI_EXPECTED_APP_SHA: releaseSha },
      broker: async (request) => {
        assert.deepEqual(request, { operation: 'gigl-capability', sha: releaseSha });
        return {
          operation: 'gigl-capability',
          sourceSha: wrongSha,
          installedSha: wrongSha,
          latchedSha: wrongSha,
          smokePassed: true,
          latched: true,
          scope: 'enabled',
        };
      },
    }),
    /broker GIGL capability smoke receipt is invalid/
  );
  assert.equal(
    publicationRuns(
      manualContext({ 'gigl-worker-capability': { result: 'failure' } })
    ),
    false,
    'a mismatched broker SHA makes the smoke job fail and blocks publication'
  );
});

test('failed, skipped, or missing cache capability blocks publication', () => {
  for (const cacheResult of ['failure', 'skipped', undefined]) {
    const context = manualContext();
    if (cacheResult === undefined) delete context.needs['cache-invalidation-worker-capability'];
    else context.needs['cache-invalidation-worker-capability'] = { result: cacheResult };
    assert.equal(
      publicationRuns(context),
      false,
      `publication must block when cache capability result is ${cacheResult ?? 'missing'}`
    );
  }
});

test('accepts the broker smoke only when its receipt matches the published SHA', async () => {
  const smoke = deploymentWorkflow.jobs['gigl-worker-capability'].steps.find(
    (step) => step.run === 'node .github/scripts/run-gigl-capability-smoke.mjs'
  );
  assert.equal(smoke.env.BACI_EXPECTED_APP_SHA, '${{ github.sha }}');

  const message = await runGiglCapabilitySmoke({
    env: { BACI_EXPECTED_APP_SHA: releaseSha },
    broker: async (request) => {
      assert.deepEqual(request, { operation: 'gigl-capability', sha: releaseSha });
      return {
        operation: 'gigl-capability',
        sourceSha: releaseSha,
        installedSha: releaseSha,
        latchedSha: releaseSha,
        smokePassed: true,
        latched: true,
        scope: 'disabled',
      };
    },
  });
  assert.match(message, new RegExp(releaseSha));
  assert.equal(publicationRuns(manualContext()), true);

  assert.equal(
    publicationRuns({
      ...manualContext(),
      inputs: { expected_release_sha: 'b'.repeat(40) },
    }),
    false,
    'a coordinator SHA different from github.sha cannot publish'
  );
});

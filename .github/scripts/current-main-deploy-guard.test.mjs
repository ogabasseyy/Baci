import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import YAML from 'yaml';

import { verifyCurrentMainDeployment } from './current-main-deploy-guard.mjs';

const expectedSha = 'a'.repeat(40);
const currentSha = 'b'.repeat(40);
const intermediateSha = 'c'.repeat(40);
const olderDeployedSha = 'd'.repeat(40);

test('tests helper-only sales repair changes and rejects deployments superseded by them', async () => {
  const helper = '.github/scripts/repair-sales-migration-collision.sh';
  const filters = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  const deployment = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  assert.ok(deployment.migrations.includes(helper));
  for (const filename of [helper, helper.replace('.sh', '.test.mjs'), helper.replace('.sh', '.sql.test.mjs')]) {
    assert.ok(Object.values(filters).some((patterns) => patterns.includes(filename)));
  }
  await assert.rejects(verifySupersededFile(helper), /superseded deployment SHA/);
});

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

function makeCompareResponse(filename, commits = [{ sha: currentSha }]) {
  return response({
    commits,
    files: [{ filename }],
    merge_base_commit: { sha: expectedSha },
    status: 'ahead',
    total_commits: commits.length,
  });
}

async function verifySupersededFile(
  filename,
  workflowRuns = [{ conclusion: 'success', head_sha: currentSha }],
  commits = [{ sha: currentSha }]
) {
  return verifyCurrentMainDeployment({
    expectedSha,
    fetchImpl: async (url) => {
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
      if (url.includes('/compare/')) return makeCompareResponse(filename, commits);
      return response({ workflow_runs: workflowRuns });
    },
    repository: 'ogabasseyy/Baci',
    token: 'test-token',
  });
}

test('accepts when the deployment SHA is the current main ref', async () => {
  const calls = [];
  const result = await verifyCurrentMainDeployment({
    expectedSha,
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return response({ object: { sha: expectedSha } });
    },
    repository: 'ogabasseyy/Baci',
    token: 'test-token',
  });

  assert.deepEqual(result, { currentSha: expectedSha, expectedSha });
  assert.equal(calls[0].url, 'https://api.github.com/repos/ogabasseyy/Baci/git/ref/heads/main');
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-token');
});

test('rejects a superseded deployment SHA once a newer commit has deployed', async () => {
  await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx'), /superseded deployment SHA/);
});

test('accepts an in-flight ancestor when no superseding commit has deployed yet', async () => {
  const urls = [];
  const result = await verifyCurrentMainDeployment({
    expectedSha,
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
      if (url.includes('/compare/')) {
        return makeCompareResponse('apps/web/src/app/page.tsx', [{ sha: intermediateSha }, { sha: currentSha }]);
      }
      return response({ workflow_runs: [{ conclusion: 'success', head_sha: olderDeployedSha }] });
    },
    repository: 'ogabasseyy/Baci',
    token: 'test-token',
  });

  assert.deepEqual(result, { currentSha, expectedSha });
  assert.ok(urls.some((u) => u.includes('head_sha=')));
});

test('rejects an ancestor when an intermediate superseding commit has deployed', async () => {
  await assert.rejects(
    verifySupersededFile(
      'apps/web/src/app/page.tsx',
      [{ conclusion: 'success', head_sha: intermediateSha }],
      [{ sha: intermediateSha }, { sha: currentSha }]
    ),
    /superseded deployment SHA/
  );
});

test('rejects an ancestor when a superseding commit completed with failure', async () => {
  await assert.rejects(
    verifySupersededFile(
      'apps/web/src/app/page.tsx',
      [{ conclusion: 'failure', head_sha: currentSha, status: 'completed' }]
    ),
    /superseded deployment SHA/
  );
});

test('accepts an in-flight ancestor when superseding commit is queued or in_progress', async () => {
  const result = await verifySupersededFile(
    'apps/web/src/app/page.tsx',
    [
      { conclusion: null, head_sha: currentSha, status: 'queued' },
      { conclusion: 'cancelled', head_sha: intermediateSha, status: 'completed' },
    ],
    [{ sha: intermediateSha }, { sha: currentSha }]
  );
  assert.deepEqual(result, { currentSha, expectedSha });
});

test('accepts an ancestor when only non-web paths supersede it', async () => {
  const urls = [];
  const result = await verifyCurrentMainDeployment({
    expectedSha,
    fetchImpl: async (url) => {
      urls.push(url);
      if (urls.length === 1) return response({ object: { sha: currentSha } });
      return response({
        files: [{ filename: 'docs/operations.md' }],
        merge_base_commit: { sha: expectedSha },
        status: 'ahead',
        total_commits: 1,
      });
    },
    repository: 'ogabasseyy/Baci',
    token: 'test-token',
  });

  assert.deepEqual(result, { currentSha, expectedSha });
  assert.match(
    urls[1],
    new RegExp(`/compare/${expectedSha}\\.\\.\\.${currentSha}`)
  );
});

test('fails closed when the superseding comparison is incomplete', async () => {
  let call = 0;
  await assert.rejects(
    verifyCurrentMainDeployment({
      expectedSha,
      fetchImpl: async () => {
        call += 1;
        if (call === 1) return response({ object: { sha: currentSha } });
        return response({
          files: [],
          merge_base_commit: { sha: expectedSha },
          status: 'ahead',
          total_commits: 101,
        });
      },
      repository: 'ogabasseyy/Baci',
      token: 'test-token',
    }),
    /incomplete or non-ancestral superseding comparison/
  );
});

test('rejects every web path declared by the deploy filter', async (context) => {
  const filters = YAML.parse(
    readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8')
  );
  for (const pattern of filters.web) {
    const representative = pattern
      .replaceAll('**', 'nested/example.js')
      .replaceAll('*', 'example');
    await context.test(pattern, async () => {
      await assert.rejects(
        verifySupersededFile(representative),
        /superseded deployment SHA/
      );
    });
  }
});

test('rejects migration-only superseding deployments', async () => {
  await assert.rejects(
    verifySupersededFile('supabase/migrations/20260828180000_replay.sql'),
    /superseded deployment SHA/
  );
});

test('gates Vercel deployment configuration in deploy and CI filters', () => {
  const deployFilters = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  const ciFilters = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  for (const path of ['.vercelignore', 'vercel.json']) {
    assert.ok(deployFilters.web.includes(path), `deploy filter: ${path}`);
    assert.ok(ciFilters.web.includes(path), `CI web filter: ${path}`);
  }
});

test('root public guide assets trigger web CI and production deployment', async () => {
  const deployFilters = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  const ciFilters = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  assert.ok(deployFilters.web.includes('public/guides/**'));
  assert.ok(ciFilters.web.includes('public/guides/**'));
  await assert.rejects(verifySupersededFile('public/guides/chatgpt-ads/01-pixel-setup.png'), /superseded deployment SHA/);
});

test('fails closed on malformed identity and GitHub API responses', async () => {
  await assert.rejects(
    verifyCurrentMainDeployment({ expectedSha: 'not-a-sha', fetchImpl: async () => response({ object: { sha: expectedSha } }), repository: 'ogabasseyy/Baci', token: 'test-token' }),
    /invalid deployment SHA/
  );
  await assert.rejects(
    verifyCurrentMainDeployment({ expectedSha, fetchImpl: async () => response({}, { ok: false, status: 503 }), repository: 'ogabasseyy/Baci', token: 'test-token' }),
    /GitHub lookup failed with status 503/
  );
  await assert.rejects(
    verifyCurrentMainDeployment({ expectedSha, fetchImpl: async () => response({ object: { sha: 'malformed' } }), repository: 'ogabasseyy/Baci', token: 'test-token' }),
    /invalid current main SHA/
  );
  await assert.rejects(
    verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'success', head_sha: 'bad-sha' }]),
    /invalid workflow run SHA/
  );
  await assert.rejects(
    verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'success', head_sha: currentSha }], [{ sha: 'bad-sha' }]),
    /invalid superseding commit SHA/
  );
  await assert.rejects(
    verifyCurrentMainDeployment({
      expectedSha,
      fetchImpl: async (url) => {
        if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
        if (url.includes('/compare/')) return makeCompareResponse('apps/web/src/app/page.tsx');
        return response({ workflow_runs: 'not-an-array' });
      },
      repository: 'ogabasseyy/Baci',
      token: 'test-token',
    }),
    /invalid workflow runs response/
  );
});

test('production deploy is staged and binds the exact-main guard', () => {
  const workflow = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8');
  const postdeployAction = readFileSync(new URL('../actions/postdeploy-migrations/action.yml', import.meta.url), 'utf8');

  assert.match(workflow, /DEPLOY_CURRENT_MAIN_GUARD: \.github\/scripts\/current-main-deploy-guard\.mjs/);
  assert.match(workflow, /deploy --yes --prebuilt --prod --skip-domain --archive=tgz/);
  const deployJob = workflow.slice(workflow.indexOf('  deploy-production:'));
  const prebuildGuard = deployJob.indexOf('- name: Verify exact-main deployment authority before build');
  assert.ok(prebuildGuard > 0, 'missing prebuild exact-main guard');
  const nodeSetup = deployJob.indexOf('- name: Setup Node.js for deployment authority guard');
  assert.ok(nodeSetup > 0 && nodeSetup < prebuildGuard, 'Node must be set up before the guard');
  assert.ok(prebuildGuard < deployJob.indexOf('- uses: ./.github/actions/pnpm-install-cached'), 'exact-main guard must run before dependency installation and build');
  const postdeployActionStep = deployJob.indexOf('- uses: ./.github/actions/postdeploy-migrations');
  assert.ok(postdeployActionStep >= 0, 'postdeploy action must exist');
  assert.match(deployJob.slice(postdeployActionStep), /supabase-access-token: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(deployJob.slice(postdeployActionStep), /supabase-project-ref: \$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}/);
  const drainStep = postdeployAction.indexOf('- name: Drain previous storefront order requests');
  const postdeployGuard = postdeployAction.indexOf('- name: Verify exact-main deployment authority before postdeploy migrations');
  const postdeployMigrations = postdeployAction.indexOf('- name: Apply migrations deferred until application deploy');
  assert.ok(drainStep >= 0 && postdeployGuard > drainStep, 'postdeploy guard must run after drain');
  assert.ok(postdeployMigrations > postdeployGuard, 'postdeploy guard must run immediately before deferred migrations');
  assert.doesNotMatch(
    postdeployAction.slice(postdeployGuard, postdeployMigrations),
    /\n\s*-\s+(?:name|run|uses):/,
    'no workflow step may separate the postdeploy guard from deferred migrations'
  );
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import YAML from 'yaml';

import { verifyCurrentMainDeployment } from './current-main-deploy-guard.mjs';

const expectedSha = 'a'.repeat(40);
const currentSha = 'b'.repeat(40);

test('tests helper-only sales repair changes and rejects deployments superseded by them', async () => {
  const helper = '.github/scripts/repair-sales-migration-collision.sh';
  const filters = YAML.parse(
    readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8')
  );
  const groups = Object.values(filters);
  const deployment = YAML.parse(
    readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8')
  );
  assert.ok(deployment.migrations.includes(helper));
  for (const filename of [helper, helper.replace('.sh', '.test.mjs'), helper.replace('.sh', '.sql.test.mjs')]) {
    assert.ok(groups.some((patterns) => patterns.includes(filename)));
  }
  await assert.rejects(verifySupersededFile(helper), /superseded deployment SHA/);
});

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

async function verifySupersededFile(filename) {
  let call = 0;
  return verifyCurrentMainDeployment({
    expectedSha,
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return response({ object: { sha: currentSha } });
      return response({
        files: [{ filename }],
        merge_base_commit: { sha: expectedSha },
        status: 'ahead',
        total_commits: 1,
      });
    },
    repository: 'ogabasseyy/Baci',
    token: 'test-token',
  });
}

test('accepts only when the deployment SHA is the current main ref', async () => {
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
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/ogabasseyy/Baci/git/ref/heads/main'
  );
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-token');
});

test('rejects a superseded deployment SHA', async () => {
  let call = 0;
  await assert.rejects(
    verifyCurrentMainDeployment({
      expectedSha,
      fetchImpl: async () => {
        call += 1;
        if (call === 1) return response({ object: { sha: currentSha } });
        return response({
          files: [{ filename: 'apps/web/src/app/page.tsx' }],
          merge_base_commit: { sha: expectedSha },
          status: 'ahead',
          total_commits: 1,
        });
      },
      repository: 'ogabasseyy/Baci',
      token: 'test-token',
    }),
    /superseded deployment SHA/
  );
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

test('rejects every web path declared by the deploy filter', async () => {
  const filters = YAML.parse(
    readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8')
  );
  for (const pattern of filters.web) {
    const representative = pattern
      .replaceAll('**', 'nested/example.js')
      .replaceAll('*', 'example');
    await assert.rejects(
      verifySupersededFile(representative),
      /superseded deployment SHA/,
      pattern
    );
  }
});

test('rejects migration-only superseding deployments', async () => {
  await assert.rejects(
    verifySupersededFile('supabase/migrations/20260828180000_replay.sql'),
    /superseded deployment SHA/
  );
});

test('gates Vercel deployment configuration in deploy and CI filters', () => {
  const deployFilters = YAML.parse(
    readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8')
  );
  const ciFilters = YAML.parse(
    readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8')
  );

  for (const path of ['.vercelignore', 'vercel.json']) {
    assert.ok(deployFilters.web.includes(path), `deploy filter: ${path}`);
    assert.ok(ciFilters.web.includes(path), `CI web filter: ${path}`);
  }
});

test('keeps Vercel function routes while leaving Fluid memory to supported sources', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')
  );
  const functions = config.functions ?? {};
  const expectedRoutes = [
    'src/app/api/ai-jobs/worker/route.ts',
    'src/app/api/ai/grade-device/route.ts',
    'src/app/api/feed/google-merchant/route.ts',
    'src/app/api/orders/[id]/invoice/route.ts',
    'src/app/api/storefront/account/orders/[id]/invoice/route.ts',
    'src/app/api/storefront/account/orders/[id]/receipt/route.ts',
  ];

  assert.deepEqual(Object.keys(functions), expectedRoutes);
  for (const [route, options] of Object.entries(functions)) {
    assert.equal(
      Object.hasOwn(options, 'memory'),
      false,
      `${route} must not configure memory in vercel.json`
    );
  }

  assert.deepEqual(config.regions, ['dub1']);
  assert.deepEqual(config.crons, [
    { path: '/api/cron/web-vitals-health', schedule: '0 4 * * *' },
    { path: '/api/cron/gigl-tracking', schedule: '*/5 * * * *' },
    {
      path: '/api/cron/gigl-tracking-notifications',
      schedule: '*/10 * * * *',
    },
  ]);
});

test('fails closed on malformed identity and GitHub API responses', async () => {
  await assert.rejects(
    verifyCurrentMainDeployment({
      expectedSha: 'not-a-sha',
      fetchImpl: async () => response({ object: { sha: expectedSha } }),
      repository: 'ogabasseyy/Baci',
      token: 'test-token',
    }),
    /invalid deployment SHA/
  );
  await assert.rejects(
    verifyCurrentMainDeployment({
      expectedSha,
      fetchImpl: async () => response({}, { ok: false, status: 503 }),
      repository: 'ogabasseyy/Baci',
      token: 'test-token',
    }),
    /GitHub lookup failed with status 503/
  );
  await assert.rejects(
    verifyCurrentMainDeployment({
      expectedSha,
      fetchImpl: async () => response({ object: { sha: 'malformed' } }),
      repository: 'ogabasseyy/Baci',
      token: 'test-token',
    }),
    /invalid current main SHA/
  );
});

test('production deploy is staged and binds the exact-main guard', () => {
  const workflow = readFileSync(
    new URL('../workflows/deploy.yml', import.meta.url),
    'utf8'
  );
  const postdeployAction = readFileSync(
    new URL('../actions/postdeploy-migrations/action.yml', import.meta.url),
    'utf8'
  );

  assert.match(
    workflow,
    /DEPLOY_CURRENT_MAIN_GUARD: \.github\/scripts\/current-main-deploy-guard\.mjs/
  );
  assert.match(
    workflow,
    /deploy --yes --prebuilt --prod --skip-domain --archive=tgz/
  );
  const deployJob = workflow.slice(workflow.indexOf('  deploy-production:'));
  const prebuildGuard = deployJob.indexOf(
    '- name: Verify exact-main deployment authority before build'
  );
  assert.ok(prebuildGuard > 0, 'missing prebuild exact-main guard');
  const nodeSetup = deployJob.indexOf(
    '- name: Setup Node.js for deployment authority guard'
  );
  assert.ok(nodeSetup > 0, 'missing Node setup for exact-main guard');
  assert.ok(nodeSetup < prebuildGuard, 'Node must be set up before the guard');
  assert.ok(
    prebuildGuard <
      deployJob.indexOf('- uses: ./.github/actions/pnpm-install-cached'),
    'exact-main guard must run before dependency installation and build'
  );
  const postdeployActionStep = deployJob.indexOf(
    '- uses: ./.github/actions/postdeploy-migrations'
  );
  assert.ok(postdeployActionStep >= 0, 'postdeploy action must exist');
  assert.match(
    deployJob.slice(postdeployActionStep),
    /supabase-access-token: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/
  );
  assert.match(
    deployJob.slice(postdeployActionStep),
    /supabase-project-ref: \$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}/
  );
  const drainStep = postdeployAction.indexOf(
    '- name: Drain previous storefront order requests'
  );
  const postdeployGuard = postdeployAction.indexOf(
    '- name: Verify exact-main deployment authority before postdeploy migrations'
  );
  const postdeployMigrations = postdeployAction.indexOf(
    '- name: Apply migrations deferred until application deploy'
  );
  assert.ok(drainStep >= 0, 'drain step must exist');
  assert.ok(postdeployGuard >= 0, 'postdeploy guard must exist');
  assert.ok(postdeployMigrations >= 0, 'deferred migrations step must exist');
  assert.ok(postdeployGuard > drainStep, 'postdeploy guard must run after drain');
  assert.ok(
    postdeployGuard < postdeployMigrations,
    'postdeploy guard must run immediately before deferred migrations'
  );
  assert.doesNotMatch(
    postdeployAction.slice(postdeployGuard, postdeployMigrations),
    /\n\s*-\s+(?:name|run|uses):/,
    'no workflow step may separate the postdeploy guard from deferred migrations'
  );
});

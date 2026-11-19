import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import { DEPLOY_PATTERNS, validateDeployPattern, verifyCurrentMainDeployment } from './current-main-deploy-guard.mjs';

const [expectedSha, currentSha, intermediateSha, olderDeployedSha] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(40));

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

function makeCompareResponse(filename, commits = [{ sha: currentSha }]) {
  const files = (Array.isArray(filename) ? filename : [filename]).map((f) => ({ filename: f }));
  return response({ commits, files, merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: commits.length });
}

async function verifySupersededFile(
  filename,
  workflowRuns = [{ conclusion: 'success', head_sha: currentSha, id: 123, status: 'completed' }],
  commits = [{ sha: currentSha }],
  jobs = [{ conclusion: 'success', name: 'deploy-production', status: 'completed' }]
) {
  return verifyCurrentMainDeployment({
    expectedSha,
    fetchImpl: async (url) => {
      if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
      if (url.includes('/compare/')) return makeCompareResponse(filename, commits);
      if (url.includes('/commits/')) return response({ files: [{ filename }] });
      const jobMatch = url.match(/\/runs\/(\d+)\/jobs/);
      if (jobMatch) {
        const runJobs = Array.isArray(jobs) ? jobs : (jobs[Number(jobMatch[1])] ?? []);
        return response({ jobs: runJobs, total_count: runJobs.length });
      }
      const shaMatch = url.match(/head_sha=([0-9a-f]{40})/);
      const runs = shaMatch ? workflowRuns.filter((r) => r.head_sha === shaMatch[1] || !/^[0-9a-f]{40}$/.test(r.head_sha ?? '')) : workflowRuns;
      return response({ total_count: runs.length, workflow_runs: runs });
    },
    repository: 'ogabasseyy/Baci',
    token: 'test-token',
  });
}

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

test('accepts when the deployment SHA is the current main ref', async () => {
  const calls = [];
  const result = await verifyCurrentMainDeployment({ expectedSha, fetchImpl: async (url, options) => { calls.push({ options, url }); return response({ object: { sha: expectedSha } }); }, repository: 'ogabasseyy/Baci', token: 'test-token' });
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
      if (url.includes('/compare/')) return makeCompareResponse('apps/web/src/app/page.tsx', [{ sha: intermediateSha }, { sha: currentSha }]);
      if (url.includes('/commits/')) return response({ files: [{ filename: 'apps/web/src/app/page.tsx' }] });
      return url.includes('/jobs') ? response({ jobs: [{ conclusion: 'success', name: 'deploy-production' }] }) : response({ workflow_runs: [{ conclusion: 'success', head_sha: olderDeployedSha, id: 456, status: 'completed' }] });
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
      [
        { conclusion: null, head_sha: currentSha, id: 101, status: 'queued' },
        { conclusion: 'success', head_sha: intermediateSha, id: 102, status: 'completed' },
      ],
      [{ sha: intermediateSha }, { sha: currentSha }],
      {
        101: [],
        102: [{ conclusion: 'success', name: 'deploy-production', status: 'completed' }],
      }
    ),
    /superseded deployment SHA/
  );
});

test('distinguishes post-promote failure from pre-promote failure', async () => {
  await assert.rejects(
    verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'failure', head_sha: currentSha, id: 123, status: 'completed' }], [{ sha: currentSha }], [{ conclusion: 'failure', name: 'deploy-production', status: 'completed', steps: [{ conclusion: 'success', name: 'Deploy to Vercel (with retry)' }] }]),
    /superseded deployment SHA/
  );
  const result = await verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'failure', head_sha: currentSha, id: 123, status: 'completed' }], [{ sha: currentSha }], [{ conclusion: 'failure', name: 'deploy-production', status: 'completed', steps: [{ conclusion: 'skipped', name: 'Deploy to Vercel (with retry)' }] }]);
  assert.deepEqual(result, { currentSha, expectedSha });
});

test('accepts an in-flight ancestor when superseding commit is queued or in_progress without deploy', async () => {
  const result = await verifySupersededFile(
    'apps/web/src/app/page.tsx',
    [{ conclusion: null, head_sha: currentSha, id: 124, run_attempt: 1, status: 'queued' }, { conclusion: 'cancelled', head_sha: intermediateSha, id: 125, status: 'completed' }],
    [{ sha: intermediateSha }, { sha: currentSha }],
    [{ conclusion: 'cancelled', name: 'deploy-production', status: 'completed', steps: [{ conclusion: 'skipped', name: 'Deploy to Vercel (with retry)' }] }]
  );
  assert.deepEqual(result, { currentSha, expectedSha });
});

test('rejects an ancestor when superseding job or deploy step is active or succeeded', async () => {
  for (const jobs of [
    [{ conclusion: 'success', name: 'deploy-production', status: 'completed' }],
    [{ conclusion: null, name: 'deploy-production', status: 'in_progress', steps: [{ conclusion: 'success', name: 'Deploy to Vercel (with retry)' }] }],
    [{ conclusion: null, name: 'deploy-production', status: 'in_progress', steps: [{ name: 'Deploy to Vercel (with retry)', status: 'in_progress' }] }],
  ]) {
    await assert.rejects(
      verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: null, head_sha: currentSha, id: 126, status: 'in_progress' }], [{ sha: currentSha }], jobs),
      /superseded deployment SHA/
    );
  }
});

test('fails closed when publication step was attempted and accepts pre-deploy cancellation', async () => {
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    await assert.rejects(
      verifySupersededFile(
        'apps/web/src/app/page.tsx',
        [{ conclusion: 'cancelled', head_sha: currentSha, id: 127, status: 'completed' }],
        [{ sha: currentSha }],
        [{ conclusion: 'cancelled', name: 'deploy-production', status: 'completed', steps: [{ conclusion, name: 'Deploy to Vercel (with retry)' }] }]
      ),
      /superseded deployment SHA/
    );
  }
  const result = await verifySupersededFile(
    'apps/web/src/app/page.tsx',
    [{ conclusion: 'cancelled', head_sha: currentSha, id: 128, status: 'completed' }],
    [{ sha: currentSha }],
    [{ conclusion: 'cancelled', name: 'deploy-production', status: 'completed', steps: [{ conclusion: 'skipped', name: 'Deploy to Vercel (with retry)' }] }]
  );
  assert.deepEqual(result, { currentSha, expectedSha });
});

test('short-circuits lookups when newest superseding commit is already deployed', async () => {
  const queriedShas = [];
  await assert.rejects(
    verifyCurrentMainDeployment({
      expectedSha,
      fetchImpl: async (url) => {
        if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
        if (url.includes('/compare/')) return makeCompareResponse('apps/web/src/app/page.tsx', [{ sha: intermediateSha }, { sha: currentSha }]);
        if (url.includes('/commits/')) return response({ files: [{ filename: 'apps/web/src/app/page.tsx' }] });
        if (url.includes('/jobs')) return response({ jobs: [{ conclusion: 'success', name: 'deploy-production' }] });
        const match = url.match(/head_sha=([0-9a-f]{40})/);
        if (match) queriedShas.push(match[1]);
        return response({ workflow_runs: [{ conclusion: 'success', head_sha: currentSha, id: 129, status: 'completed' }] });
      },
      repository: 'ogabasseyy/Baci',
      token: 'test-token',
    }),
    /superseded deployment SHA/
  );
  assert.deepEqual(queriedShas, [currentSha]);
});

test('accepts an ancestor when only non-web paths supersede it', async () => {
  const urls = [];
  const result = await verifyCurrentMainDeployment({
    expectedSha,
    fetchImpl: async (url) => {
      urls.push(url);
      if (urls.length === 1) return response({ object: { sha: currentSha } });
      return response({ files: [{ filename: 'docs/operations.md' }], merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: 1 });
    },
    repository: 'ogabasseyy/Baci',
    token: 'test-token',
  });
  assert.deepEqual(result, { currentSha, expectedSha });
  assert.match(urls[1], /repos\/ogabasseyy\/Baci\/compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}/);
});

test('fails closed when the superseding comparison is incomplete', async () => {
  for (const comparison of [
    { files: [{ filename: 'apps/web/src/app/page.tsx' }], merge_base_commit: { sha: expectedSha }, status: 'diverged', total_commits: 1 },
    { files: [{ filename: 'apps/web/src/app/page.tsx' }], merge_base_commit: { sha: intermediateSha }, status: 'ahead', total_commits: 1 },
    { files: [{ filename: 'apps/web/src/app/page.tsx' }], merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: 0 },
    { files: 'not-an-array', merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: 2 },
    { files: [{ filename: 'apps/web/src/app/page.tsx' }], merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: 2, commits: [{ sha: currentSha }] },
  ]) {
    await assert.rejects(verifyCurrentMainDeployment({ expectedSha, fetchImpl: async (url) => url.includes('/git/ref') ? response({ object: { sha: currentSha } }) : response(comparison), repository: 'ogabasseyy/Baci', token: 'test-token' }), /incomplete or non-ancestral superseding comparison|incomplete superseding commit list/);
  }
});

test('rejects every web path declared by the deploy filter', async (t) => {
  const deployment = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  assert.deepEqual(DEPLOY_PATTERNS, [...deployment.web, ...deployment.migrations]);
  assert.ok('length' in DEPLOY_PATTERNS && 0 in DEPLOY_PATTERNS && DEPLOY_PATTERNS.filter(Boolean).length === DEPLOY_PATTERNS.length);
  for (const pattern of deployment.web) {
    const candidate = pattern.endsWith('/**') ? `${pattern.slice(0, -3)}/nested/file.ts` : pattern.replaceAll('*', 'example');
    await t.test(pattern, async () => {
      await assert.rejects(verifySupersededFile(candidate), /superseded deployment SHA/);
    });
  }
});

test('rejects migration-only superseding deployments', async () => {
  await assert.rejects(verifySupersededFile('supabase/migrations/20261103000000_test_migration.sql'), /superseded deployment SHA/);
});

test('gates Vercel deployment configuration in deploy and CI filters', () => {
  const [deployment, ci] = ['deploy.yml', 'ci.yml'].map((f) => YAML.parse(readFileSync(new URL(`../filters/${f}`, import.meta.url), 'utf8')));
  for (const path of ['.vercelignore', 'vercel.json']) assert.ok(deployment.web.includes(path) && ci.web.includes(path), 'gates ' + path);
});

test('root public guide assets trigger web CI and production deployment', async () => {
  const deployment = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  const ci = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  assert.ok(deployment.web.includes('public/guides/**'));
  assert.ok(ci.web.includes('public/guides/**'));
  await assert.rejects(verifySupersededFile('public/guides/chatgpt-ads/01-pixel-setup.png'), /superseded deployment SHA/);
});

test('detects earlier successful deploy attempt when rerun is queued or failed', async () => {
  const jobs = [{ conclusion: 'cancelled', name: 'deploy-production', status: 'completed', steps: [{ conclusion: 'skipped', name: 'Deploy to Vercel (with retry)' }] }, { conclusion: 'success', name: 'deploy-production', status: 'completed' }];
  for (const { status, run_attempt } of [{ status: 'queued', run_attempt: 2 }, { status: 'queued', run_attempt: null }, { status: 'completed', run_attempt: 2 }]) {
    await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: status === 'queued' ? null : 'failure', head_sha: currentSha, id: 130, run_attempt, status }], [{ sha: currentSha }], jobs), /superseded deployment SHA/);
  }
});

test('fails closed on malformed identity, API responses, or response truncation', async () => {
  for (const [args, re] of [
    [{ expectedSha: 'not-a-sha', fetchImpl: async () => response({ object: { sha: expectedSha } }), repository: 'ogabasseyy/Baci', token: 'test-token' }, /invalid deployment SHA/],
    [{ expectedSha, fetchImpl: async () => response({}, { ok: false, status: 503 }), repository: 'ogabasseyy/Baci', token: 'test-token' }, /GitHub lookup failed with status 503/],
    [{ expectedSha, fetchImpl: async () => response({ object: { sha: 'malformed' } }), repository: 'ogabasseyy/Baci', token: 'test-token' }, /invalid current main SHA/],
    [{ expectedSha, fetchImpl: async (url) => { if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } }); if (url.includes('/compare/')) return makeCompareResponse('apps/web/src/app/page.tsx'); return response({ workflow_runs: 'not-an-array' }); }, repository: 'ogabasseyy/Baci', token: 'test-token' }, /invalid workflow runs response/],
    [{ expectedSha, fetchImpl: async (url) => { if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } }); if (url.includes('/compare/')) return makeCompareResponse('apps/web/src/app/page.tsx'); return response({ total_count: 105, workflow_runs: [{ conclusion: 'success', head_sha: currentSha, id: 1, status: 'completed' }] }); }, repository: 'ogabasseyy/Baci', token: 'test-token' }, /incomplete or invalid workflow runs response/],
    [{ expectedSha, fetchImpl: async (url) => { if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } }); if (url.includes('/compare/')) return makeCompareResponse('apps/web/src/app/page.tsx'); if (url.includes('/jobs')) return response({ jobs: [], total_count: 5 }); return response({ workflow_runs: [{ conclusion: 'success', head_sha: currentSha, id: 1, status: 'completed' }] }); }, repository: 'ogabasseyy/Baci', token: 'test-token' }, /incomplete or invalid workflow jobs response/],
  ]) await assert.rejects(verifyCurrentMainDeployment(args), re);
  await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'success', head_sha: 'bad-sha', id: 1, status: 'completed' }]), /invalid workflow run SHA/);
  for (const st of ['completed', 'queued']) await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ head_sha: currentSha, id: null, status: st }]), /invalid workflow run id/);
  await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'success', head_sha: currentSha, id: 1, status: 'completed' }], [{ sha: 'bad-sha' }]), /invalid superseding commit SHA/);
  for (const [st, cc] of [['completed', 'failure'], ['in_progress', null]]) await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: cc, head_sha: currentSha, id: 1, status: st }], [{ sha: currentSha }], [{ conclusion: cc, name: 'deploy-production', status: st, steps: [] }]), /incomplete or invalid workflow job steps response/);
  await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'success', head_sha: currentSha, id: 1, status: 'completed' }], [{ sha: currentSha }], [{ name: 'renamed-job', status: 'completed' }]), /missing deploy-production job/);
  for (const j of [[], [{ conclusion: 'cancelled', name: 'deploy-production', status: 'completed', steps: [] }], [{ conclusion: 'cancelled', name: 'deploy-production', status: 'completed', steps: [{ conclusion: 'skipped', name: 'Deploy to Vercel (with retry)' }] }]]) assert.deepEqual(await verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'cancelled', head_sha: currentSha, id: 1, status: 'completed' }], [{ sha: currentSha }], j), { currentSha, expectedSha });
  assert.deepEqual(await verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: null, head_sha: currentSha, id: 1, status: 'in_progress' }], [{ sha: currentSha }], [{ name: 'vps-worker-sync', status: 'in_progress' }]), { currentSha, expectedSha });
  assert.deepEqual(await verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'success', head_branch: 'feature-branch', head_sha: currentSha, id: 1, status: 'completed' }], [{ sha: currentSha }], [{ conclusion: 'success', name: 'deploy-production', status: 'completed' }]), { currentSha, expectedSha });
  await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: 'failure', head_sha: currentSha, id: 1, status: 'completed' }], [{ sha: currentSha }], [{ conclusion: 'failure', name: 'deploy-production', status: 'completed', steps: [{ name: 'Other step' }] }]), /missing Deploy to Vercel step/);
  await assert.rejects(verifySupersededFile('apps/web/src/app/page.tsx', [{ conclusion: null, head_sha: currentSha, id: 1, status: 'in_progress' }], [{ sha: currentSha }], [{ conclusion: null, name: 'deploy-production', status: 'in_progress', steps: [{ name: 'Other step' }] }]), /missing Deploy to Vercel step/);
  const pushFetch = async (u) => u.includes('/git/ref') ? response({ object: { sha: currentSha } }) :
    u.includes('/compare') ? makeCompareResponse(['apps/web/src/app/page.tsx', 'docs/ops.md'], [{ sha: intermediateSha }, { sha: currentSha }]) :
    response({ workflow_runs: [{ head_sha: currentSha, id: 10, run_attempt: 1, status: 'queued' }] });
  assert.deepEqual(await verifyCurrentMainDeployment({ expectedSha, fetchImpl: pushFetch, repository: 'ogabasseyy/Baci', token: 'test-token' }), { currentSha, expectedSha });
});

test('rejects unsupported picomatch glob metacharacters and complex patterns', () => {
  for (const bad of ['apps/web/** # comment', 'apps/web/ space.ts', 'apps/web/[a-z].ts', 'apps/web/{a,b}.ts', 'apps/web/?.ts', 'apps/web/(a|b).ts', 'apps/web/+a.ts', 'apps/web/@a.ts', '!apps/web/**']) {
    assert.throws(() => validateDeployPattern(bad), /unsupported glob/);
  }
});

test('production deploy is staged and binds the exact-main guard', () => {
  const workflow = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8');
  const postdeployAction = readFileSync(new URL('../actions/postdeploy-migrations/action.yml', import.meta.url), 'utf8');
  assert.match(workflow, /DEPLOY_CURRENT_MAIN_GUARD: \.github\/scripts\/current-main-deploy-guard\.mjs/);
  assert.match(workflow, /deploy --yes --prebuilt --prod --skip-domain --archive=tgz/);
  const deployJob = workflow.slice(workflow.indexOf('  deploy-production:'));
  for (const p of [/permissions:[\s\S]*?actions: read/, /permissions:[\s\S]*?contents: read/, /- name: Deploy to Vercel \(with retry\)/, /^\s*deploy-production:\s*$/m]) assert.match(deployJob, p);
  const jobCfg = YAML.parse(workflow).jobs['deploy-production'];
  assert.equal(jobCfg.name, undefined);
  assert.deepEqual(jobCfg.concurrency, { 'cancel-in-progress': false, group: 'production-prebuilt-deploy' });
  const prebuild = deployJob.indexOf('- name: Verify exact-main deployment authority before build');
  const nodeSetup = deployJob.indexOf('- name: Setup Node.js for deployment authority guard');
  assert.ok(prebuild > 0 && nodeSetup > 0 && nodeSetup < prebuild, 'exact-main guard ordering');
  assert.ok(prebuild < deployJob.indexOf('- uses: ./.github/actions/pnpm-install-cached'));
  const postAction = deployJob.indexOf('- uses: ./.github/actions/postdeploy-migrations');
  assert.ok(postAction >= 0);
  for (const k of [/supabase-access-token: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/, /supabase-project-ref: \$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}/]) assert.match(deployJob.slice(postAction), k);
  const [drain, postGuard, postMig] = ['Drain previous storefront order requests', 'Verify exact-main deployment authority before postdeploy migrations', 'Apply migrations deferred until application deploy'].map((s) => postdeployAction.indexOf(`- name: ${s}`));
  assert.ok(drain >= 0 && postGuard > drain && postMig > postGuard, 'postdeploy guard order');
  assert.doesNotMatch(postdeployAction.slice(postGuard, postMig), /\n\s*-\s+(?:name|run|uses):/);
});

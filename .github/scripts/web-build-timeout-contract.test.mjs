import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

test('gives the bounded storefront build enough time to finish page-data collection', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));

  assert.equal(workflow.jobs.build.name, 'Build');
  assert.equal(workflow.jobs.build['timeout-minutes'], 45);
});

test('keeps pull-request builds offline from production Supabase', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
  const buildStep = workflow.jobs.build.steps.find(({ run }) =>
    run?.includes('pnpm --filter @baci/web build:ci')
  );

  assert.ok(buildStep, 'expected the Build job to invoke the web build');
  assert.deepEqual(buildStep.env, {
    NODE_OPTIONS: '--max_old_space_size=8192',
    NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-key',
    SUPABASE_JWT_SECRET: 'placeholder-jwt-secret',
  });
});


test('reclaims hosted-runner disk before dependency and Next cache restoration', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
  const steps = workflow.jobs.build.steps;
  const reclaim = steps.findIndex((step) => step.name === 'Reclaim unused hosted-runner SDK space');
  const dependencies = steps.findIndex((step) => step.uses === './.github/actions/pnpm-install-cached');
  const cache = steps.findIndex((step) => step.id === 'next-cache');
  assert.ok(reclaim >= 0, 'build archives need disk preparation before extraction');
  assert.ok(reclaim < dependencies && reclaim < cache);
  assert.equal(workflow.jobs.build['runs-on'], 'ubuntu-24.04');
  assert.match(steps[reclaim].run, /sudo rm -rf -- \/usr\/share\/dotnet \/usr\/local\/lib\/android \/opt\/ghc/);
  assert.doesNotMatch(steps[reclaim].run, /rm[^\n]*(?:node_modules|GITHUB_WORKSPACE|\.next)/);
});

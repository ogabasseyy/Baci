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

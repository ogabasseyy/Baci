import assert from 'node:assert/strict';
import test from 'node:test';
import { syncCacheWorkerVercelEnv } from './sync-cache-worker-vercel-env.mjs';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims = {}) => `${encode({ alg: 'ES256' })}.${encode({ role: 'cache_invalidation_worker', exp: 2_000_000_000, ...claims })}.signature`;
const envFor = (value = token()) => ({
  CACHE_INVALIDATION_WORKER_TOKEN: value,
  VERCEL_TOKEN: 'vercel-secret',
  VERCEL_PROJECT_ID: 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx',
  VERCEL_ORG_ID: 'team_P85yMqd79TPq8aSGSt2kojWY',
});

test('synchronizes only the production token and verifies one pulled assignment', async () => {
  const calls = [];
  const secret = token();
  const result = await syncCacheWorkerVercelEnv({
    env: envFor(secret),
    runVercel: (args, options) => calls.push({ args, input: options.input }),
    readProjectLink: () => JSON.stringify({ projectId: 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx', orgId: 'team_P85yMqd79TPq8aSGSt2kojWY' }),
    readEnvFile: () => `OTHER=value\nCACHE_INVALIDATION_WORKER_TOKEN=${secret}\n`,
  });
  assert.deepEqual(result, {
    key: 'CACHE_INVALIDATION_WORKER_TOKEN', target: 'production', registered: true, presenceVerified: true,
  });
  assert.deepEqual(calls.map((call) => call.args), [
    ['link', '--yes', '--project=prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx', '--scope=team_P85yMqd79TPq8aSGSt2kojWY'],
    ['pull', '--yes', '--environment=production'],
    ['env', 'add', 'CACHE_INVALIDATION_WORKER_TOKEN', 'production', '--sensitive', '--force', '--yes'],
    ['pull', '--yes', '--environment=production'],
  ]);
  assert.equal(calls[2].input, secret);
  assert.equal(calls[0].input, undefined);
});

test('rejects invalid role or expired token before calling Vercel', async () => {
  for (const invalid of [token({ role: 'service_role' }), token({ exp: 1 })]) {
    let called = false;
    await assert.rejects(syncCacheWorkerVercelEnv({
      env: envFor(invalid), runVercel: () => { called = true; }, readEnvFile: () => '',
      readProjectLink: () => '{}',
    }));
    assert.equal(called, false);
  }
});

test('rejects noncanonical project rather than updating a different Vercel project', async () => {
  let called = false;
  await assert.rejects(syncCacheWorkerVercelEnv({
    env: { ...envFor(), VERCEL_PROJECT_ID: 'another-project' },
    runVercel: () => { called = true; }, readProjectLink: () => '{}', readEnvFile: () => '',
  }));
  assert.equal(called, false);
});

test('fails closed when the pulled value is absent or ambiguous', async () => {
  for (const contents of ['', 'CACHE_INVALIDATION_WORKER_TOKEN=one\nCACHE_INVALIDATION_WORKER_TOKEN=two\n']) {
    await assert.rejects(syncCacheWorkerVercelEnv({
      env: envFor(), runVercel: () => {}, readEnvFile: () => contents,
      readProjectLink: () => JSON.stringify({ projectId: 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx', orgId: 'team_P85yMqd79TPq8aSGSt2kojWY' }),
    }));
  }
});

test('fails closed on any Vercel command failure', async () => {
  await assert.rejects(syncCacheWorkerVercelEnv({
    env: envFor(), runVercel: () => { throw new Error('Vercel Production cache worker environment update failed'); },
    readProjectLink: () => JSON.stringify({ projectId: 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx', orgId: 'team_P85yMqd79TPq8aSGSt2kojWY' }), readEnvFile: () => '',
  }));
});

test('refuses an unexpected Vercel project link before touching the environment variable', async () => {
  let mutationCalled = false;
  let calls = 0;
  await assert.rejects(syncCacheWorkerVercelEnv({
    env: envFor(),
    runVercel: (args) => { calls += 1; if (args[0] === 'env') mutationCalled = true; },
    readProjectLink: () => JSON.stringify({ projectId: 'wrong', orgId: 'team_P85yMqd79TPq8aSGSt2kojWY' }),
    readEnvFile: () => '',
  }));
  assert.equal(calls, 2);
  assert.equal(mutationCalled, false);
});

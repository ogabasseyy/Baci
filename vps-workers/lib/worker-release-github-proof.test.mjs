import assert from 'node:assert/strict';
import test from 'node:test';
import { proveCompletedWorkerAttempt } from './worker-release-github-proof.mjs';

const target = { run_id: '42', run_attempt: 1, job_id: '4201', sha: 'a'.repeat(40) };
const run = { id: 42, workflow_id: 9, path: '.github/workflows/production-release.yml', event: 'push',
  head_branch: 'main', head_sha: target.sha, run_attempt: 1, status: 'completed' };
const completedJobs = { total_count: 2, jobs: [
  { id: 4201, run_id: 42, name: 'Sync VPS workers', status: 'completed', head_sha: target.sha,
    labels: ['self-hosted', 'baci-release'], runner_name: 'release-runner' },
  { id: 4202, run_id: 42, name: 'Deploy to Vercel', status: 'completed', head_sha: target.sha,
    labels: ['ubuntu-24.04'], runner_name: 'github-hosted' },
] };

function apiFixture({ runValue = run, jobs = completedJobs } = {}) {
  return async (path) => {
    if (path === '/repos/ogabasseyy/Baci/actions/runs/42') return runValue;
    if (path === '/repos/ogabasseyy/Baci/actions/runs/42/attempts/1/jobs?per_page=100') return jobs;
    throw new Error(`unexpected GitHub path ${path}`);
  };
}

const verify = (overrides = {}) => proveCompletedWorkerAttempt({
  target,
  repository: 'ogabasseyy/Baci',
  workflowId: 9,
  runnerLabel: 'baci-release',
  apiJson: apiFixture(),
  ...overrides,
});

test('proves the exact completed worker attempt and returns its canonical identity', async () => {
  assert.deepEqual(await verify(), target);
});

test('permits a completed prior rerun attempt while the newer attempt is active', async () => {
  const rerun = { ...run, run_attempt: 2, status: 'in_progress' };
  assert.deepEqual(await verify({ apiJson: apiFixture({ runValue: rerun }) }), target);
});

test('rejects a still-active old run attempt before takeover', async () => {
  const activeRun = { ...run, status: 'in_progress' };
  await assert.rejects(verify({ apiJson: apiFixture({ runValue: activeRun }) }), /not terminal/);
});

test('fails closed when GitHub cannot prove the old run attempt', async () => {
  await assert.rejects(verify({ apiJson: async () => { throw new Error('GitHub API unavailable'); } }), /GitHub API unavailable/);
});

test('rejects active jobs, ambiguous worker jobs, and mismatched durable job identity', async () => {
  for (const jobs of [
    { ...completedJobs, jobs: completedJobs.jobs.map((job, index) => index ? job : { ...job, status: 'in_progress' }) },
    { ...completedJobs, jobs: [...completedJobs.jobs, { ...completedJobs.jobs[0], id: 4203 }] },
    { ...completedJobs, jobs: completedJobs.jobs.map((job, index) => index ? job : { ...job, head_sha: 'b'.repeat(40) }) },
  ]) {
    await assert.rejects(verify({ apiJson: apiFixture({ jobs }) }));
  }
});

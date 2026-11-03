import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyCurrentMainDeployment } from './current-main-deploy-guard.mjs';

const [expectedSha, currentSha, intermediateSha, olderDeployedSha] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(40));

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

function farAheadFetch({ runs, compares = {}, jobs = {}, pages }) {
  return async (url) => {
    if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
    const cmp = url.match(/\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})/);
    if (cmp) {
      if (cmp[2] === currentSha) return response({ commits: [{ sha: currentSha }], files: new Array(300).fill({ filename: 'apps/web/src/app/page.tsx' }), merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: 500 });
      return response(compares[cmp[2]] ?? { status: 'behind', merge_base_commit: { sha: cmp[2] }, total_commits: 0 });
    }
    const jobMatch = url.match(/\/runs\/(\d+)\/jobs/);
    if (jobMatch) { const j = jobs[jobMatch[1]] ?? []; return response({ jobs: j, total_count: j.length }); }
    const page = Number(url.match(/[?&]page=(\d+)/)?.[1] ?? 1);
    const list = pages ? (pages[page - 1] ?? []) : runs;
    return response({ total_count: list.length, workflow_runs: list });
  };
}
const ahead = { merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: 3 };
const expectedRun = { conclusion: null, head_branch: 'main', head_sha: expectedSha, id: 1, status: 'in_progress' };
const deployedJob = [{ conclusion: 'success', name: 'deploy-production', status: 'completed' }];

test('accepts an ancestor far behind main (500 commits, 300+ files) when no descendant deployed', async () => {
  const fetchImpl = farAheadFetch({ runs: [{ conclusion: null, head_branch: 'main', head_sha: currentSha, id: 2, run_attempt: 1, status: 'queued' }, expectedRun] });
  assert.deepEqual(await verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' }), { currentSha, expectedSha });
});

test('rejects a far-behind ancestor when a descendant commit already deployed', async () => {
  const fetchImpl = farAheadFetch({
    runs: [{ conclusion: 'success', head_branch: 'main', head_sha: intermediateSha, id: 3, status: 'completed' }, expectedRun],
    compares: { [intermediateSha]: ahead },
    jobs: { 3: deployedJob },
  });
  await assert.rejects(verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' }), /superseded deployment SHA/);
});

test('ignores deployed runs that are not descendants of the expected SHA', async () => {
  const fetchImpl = farAheadFetch({
    runs: [{ conclusion: 'success', head_branch: 'main', head_sha: olderDeployedSha, id: 4, status: 'completed' }, expectedRun],
    jobs: { 4: deployedJob },
  });
  assert.deepEqual(await verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' }), { currentSha, expectedSha });
});

test('finds a deployed descendant on a later runs page', async () => {
  const filler = Array.from({ length: 100 }, (_, i) => ({ conclusion: 'cancelled', head_branch: 'main', head_sha: 'e'.repeat(40), id: 1000 + i, status: 'completed' }));
  const fetchImpl = farAheadFetch({
    pages: [filler, [{ conclusion: 'success', head_branch: 'main', head_sha: intermediateSha, id: 3, status: 'completed' }, expectedRun]],
    compares: { [intermediateSha]: ahead },
    jobs: { 3: deployedJob },
  });
  await assert.rejects(verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' }), /superseded deployment SHA/);
});

test('fails closed when the expected SHA run is not found in the runs listing', async () => {
  const fetchImpl = farAheadFetch({ runs: [{ conclusion: null, head_branch: 'main', head_sha: currentSha, id: 2, status: 'queued' }] });
  await assert.rejects(verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' }), /could not locate deployment run/);
});

test('fails closed when a far-behind SHA is not an ancestor of main', async () => {
  const fetchImpl = async (url) => url.includes('/git/ref') ? response({ object: { sha: currentSha } }) : response({ status: 'diverged', merge_base_commit: { sha: intermediateSha }, total_commits: 500, files: [] });
  await assert.rejects(verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' }), /incomplete or non-ancestral superseding comparison/);
});

test('bugfix: a repeated deployed run for a non-descendant SHA is not treated as a descendant', async () => {
  const dup = (id) => ({ conclusion: 'success', head_branch: 'main', head_sha: olderDeployedSha, id, status: 'completed' });
  const fetchImpl = farAheadFetch({ runs: [dup(4), dup(5), expectedRun], jobs: { 4: deployedJob, 5: deployedJob } });
  assert.deepEqual(await verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' }), { currentSha, expectedSha });
});

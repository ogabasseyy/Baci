import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyCurrentMainDeployment } from './current-main-deploy-guard.mjs';

const [expectedSha, currentSha, intermediateSha, otherSha] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(40));
const hex = (n) => n.toString(16).padStart(40, '0');

function response(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

// Main is far ahead of expectedSha: the compare lists commitList (ending in currentSha) with 300 files.
function farAheadFetch({ runs, pages, commitList = [currentSha], total, jobs = {}, urls = [], midpoint } = {}) {
  return async (url) => {
    urls.push(url);
    if (url.includes('/git/ref/heads/main')) return response({ object: { sha: currentSha } });
    if (url.includes('/compare/')) {
      const page = Number(url.match(/[?&]page=(\d+)/)?.[1] ?? 1);
      const slice = commitList.slice((page - 1) * 100, page * 100).map((sha) => ({ sha }));
      return response({ commits: slice, files: new Array(300).fill({ filename: 'apps/web/src/app/page.tsx' }), merge_base_commit: { sha: expectedSha }, status: 'ahead', total_commits: total ?? commitList.length });
    }
    const jobMatch = url.match(/\/runs\/(\d+)\/jobs/);
    if (jobMatch) { const j = jobs[jobMatch[1]] ?? []; return response({ jobs: j, total_count: j.length }); }
    const page = Number(url.match(/[?&]page=(\d+)/)?.[1] ?? 1);
    const list = pages ? (pages[page - 1] ?? []) : runs;
    return midpoint ? midpoint(url, list) : response({ total_count: pages ? pages.flat().length : list.length, workflow_runs: list });
  };
}
const run = (sha, id, conclusion = 'success', status = 'completed', extra = {}) => ({ conclusion, head_branch: 'main', head_sha: sha, id, status, ...extra });
const expectedRun = run(expectedSha, 1, null, 'in_progress');
const deployedJob = [{ conclusion: 'success', name: 'deploy-production', status: 'completed' }];
const verify = (fetchImpl) => verifyCurrentMainDeployment({ expectedSha, fetchImpl, repository: 'ogabasseyy/Baci', token: 't' });
const accepted = { currentSha, expectedSha };

test('accepts an ancestor far behind main when no superseding commit has deployed', async () => {
  assert.deepEqual(await verify(farAheadFetch({ runs: [run(currentSha, 2, null, 'queued', { run_attempt: 1 }), expectedRun] })), accepted);
});

test('rejects a far-behind ancestor when a superseding commit already deployed', async () => {
  const fetchImpl = farAheadFetch({ runs: [run(intermediateSha, 3), expectedRun], commitList: [intermediateSha, currentSha], jobs: { 3: deployedJob } });
  await assert.rejects(verify(fetchImpl), /superseded deployment SHA/);
});

test('ignores deployed runs for commits that do not supersede the expected SHA', async () => {
  const fetchImpl = farAheadFetch({ runs: [run(otherSha, 4), run(otherSha, 5), expectedRun], jobs: { 4: deployedJob, 5: deployedJob } });
  assert.deepEqual(await verify(fetchImpl), accepted);
});

test('bugfix: checks runs older than the expected SHA run (main reset then restored)', async () => {
  const fetchImpl = farAheadFetch({ runs: [expectedRun, run(intermediateSha, 3)], commitList: [intermediateSha, currentSha], jobs: { 3: deployedJob } });
  await assert.rejects(verify(fetchImpl), /superseded deployment SHA/);
});

test('accepts when no superseding commit deployed, even without the expected run listed', async () => {
  assert.deepEqual(await verify(farAheadFetch({ runs: [run(currentSha, 2, null, 'queued', { run_attempt: 1 })] })), accepted);
});

test('finds a deployed superseding commit on a later runs page', async () => {
  const filler = Array.from({ length: 100 }, (_, i) => run(otherSha, 1000 + i, 'cancelled'));
  const fetchImpl = farAheadFetch({ pages: [filler, [run(intermediateSha, 3), expectedRun]], commitList: [intermediateSha, currentSha], jobs: { 3: deployedJob } });
  await assert.rejects(verify(fetchImpl), /superseded deployment SHA/);
});

test('detects a deployed commit that only appears on a later compare page', async () => {
  const commitList = Array.from({ length: 249 }, (_, i) => hex(i + 10)).concat(currentSha);
  const urls = [];
  const fetchImpl = farAheadFetch({ runs: [run(hex(200), 3), expectedRun], commitList, jobs: { 3: deployedJob }, urls });
  await assert.rejects(verify(fetchImpl), /superseded deployment SHA/);
  assert.equal(urls.filter((u) => u.includes('/compare/')).length, 3);
});

test('routes a 101-commit compare through the run-based check', async () => {
  const commitList = Array.from({ length: 100 }, (_, i) => hex(i + 10)).concat(currentSha);
  const fetchImpl = farAheadFetch({ runs: [run(hex(50), 3), expectedRun], commitList, jobs: { 3: deployedJob } });
  await assert.rejects(verify(fetchImpl), /superseded deployment SHA/);
});

test('fails closed when the superseding commit list is shorter than total_commits', async () => {
  await assert.rejects(verify(farAheadFetch({ runs: [expectedRun], commitList: [currentSha], total: 2 })), /incomplete superseding commit list/);
});

test('fails closed when a far-behind SHA is not an ancestor of main', async () => {
  const fetchImpl = async (url) => (url.includes('/git/ref') ? response({ object: { sha: currentSha } }) : response({ status: 'diverged', merge_base_commit: { sha: intermediateSha }, total_commits: 500, files: [] }));
  await assert.rejects(verify(fetchImpl), /incomplete or non-ancestral superseding comparison/);
});

test('bugfix: rejects a compare whose total_commits is not an integer', async () => {
  const fetchImpl = async (url) => (url.includes('/git/ref') ? response({ object: { sha: currentSha } }) : response({ status: 'ahead', merge_base_commit: { sha: expectedSha }, total_commits: '500', files: null }));
  await assert.rejects(verify(fetchImpl), /incomplete or non-ancestral superseding comparison/);
});

test('bugfix: an irregular historical run for a non-superseding commit cannot abort the guard', async () => {
  assert.deepEqual(await verify(farAheadFetch({ runs: [run(otherSha, 7), expectedRun], jobs: { 7: [] } })), accepted);
});

test('bugfix: a malformed head_sha on a non-main run is ignored', async () => {
  const bad = { conclusion: 'success', head_branch: 'feature', head_sha: 'garbage', id: 8, status: 'completed' };
  assert.deepEqual(await verify(farAheadFetch({ runs: [bad, expectedRun] })), accepted);
});

test('fails closed on a malformed head_sha for a main run', async () => {
  await assert.rejects(verify(farAheadFetch({ runs: [{ ...run('garbage', 8) }, expectedRun] })), /invalid workflow run SHA/);
});

test('bugfix: fails closed when a runs page is shorter than total_count says', async () => {
  const fetchImpl = farAheadFetch({ runs: [expectedRun], midpoint: () => response({ total_count: 400, workflow_runs: [expectedRun] }) });
  await assert.rejects(verify(fetchImpl), /incomplete or invalid workflow runs response/);
});

test('fails closed when the runs history is longer than the page cap', async () => {
  const full = Array.from({ length: 100 }, (_, i) => run(otherSha, 2000 + i, 'cancelled'));
  await assert.rejects(verify(farAheadFetch({ pages: Array.from({ length: 32 }, () => full) })), /could not exhaust deployment run history/);
});

test('bugfix: a history that ends exactly on a full final page is exhausted, not an error', async () => {
  const full = Array.from({ length: 100 }, (_, i) => run(otherSha, 3000 + i, 'cancelled'));
  assert.deepEqual(await verify(farAheadFetch({ pages: Array.from({ length: 30 }, () => full) })), accepted);
});

test('bugfix: the runs query has no server-side branch filter (capped at 1000 results)', async () => {
  const urls = [];
  await verify(farAheadFetch({ runs: [expectedRun], urls }));
  const runUrls = urls.filter((u) => u.includes('/deploy.yml/runs?'));
  assert.ok(runUrls.length > 0 && runUrls.every((u) => !u.includes('branch=')));
});

test('bugfix: counts job lookups against the request budget and fails closed', async () => {
  const commitList = Array.from({ length: 900 }, (_, i) => hex(i + 10)).concat(currentSha);
  const runs = commitList.slice(0, 100).map((sha, i) => run(sha, 100 + i, 'cancelled'));
  const pages = Array.from({ length: 9 }, (_, p) => commitList.slice(p * 100, p * 100 + 100).map((sha, i) => run(sha, 10000 + p * 100 + i, 'cancelled')));
  const urls = [];
  await assert.rejects(verify(farAheadFetch({ pages, commitList, urls, runs })), /request budget/);
  assert.ok(urls.length < 900);
});

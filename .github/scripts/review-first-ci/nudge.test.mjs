import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_ATTEMPTS, STATUS_CONTEXT, nudgePullRequest, sweepRecentRuns } from './nudge.mjs';
import { HEAD, NOW, REPO, codexRoutes, fakeGithub, fixture, pullRequest } from './test-support.mjs';

const summaryClean = { ...fixture('codex-summary-clean.json'), updated_at: '2026-11-11T13:00:00Z' };

const ciRunsPath = `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=pull_request`;
const browserRunsPath = `/repos/${REPO}/actions/workflows/checkout-browser.yml/runs?head_sha=${HEAD}&event=pull_request`;

const run = (overrides = {}) => ({
  id: 500,
  run_number: 9,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-11T13:30:00Z',
  html_url: 'https://github.com/o/r/actions/runs/500',
  pull_requests: [{ number: 7 }],
  ...overrides,
});
const skippedJob = (name) => ({ name, conclusion: 'skipped' });

const browserJob = (conclusion) => ({ name: 'Checkout - Chromium and WebKit', conclusion });

function routesFor({ issueComments = [summaryClean], ciRuns = [run()], browserRuns = [run({ id: 600, run_number: 3 })], jobs = [skippedJob('Build (deferred until Codex review)')], browserJobs = [browserJob('skipped')], pr = pullRequest() } = {}) {
  return {
    ...codexRoutes({ issueComments, pr }),
    [`GET ${ciRunsPath}`]: ciRuns,
    [`GET ${browserRunsPath}`]: browserRuns,
    [`GET /repos/${REPO}/actions/runs/500/jobs?filter=latest`]: jobs,
    [`GET /repos/${REPO}/actions/runs/600/jobs?filter=latest`]: browserJobs,
    [`POST /repos/${REPO}/actions/runs/500/rerun`]: {},
    [`POST /repos/${REPO}/actions/runs/600/rerun`]: {},
    [`POST /repos/${REPO}/statuses/${HEAD}`]: {},
  };
}

const nudge = (routes, overrides = {}) => {
  const client = fakeGithub(routes);
  const logs = [];
  return nudgePullRequest({ client, repository: REPO, prNumber: 7, mode: 'on', now: Date.parse(NOW), timeoutMinutes: 60, log: (line) => logs.push(line), ...overrides }).then((result) => ({ result, client, logs }));
};
const posted = (client) => client.calls.filter((call) => call.startsWith('POST'));

describe('nudgePullRequest', () => {
  it('re-runs the pull-request run and the browser regression once Codex is clean', async () => {
    const { result, client } = await nudge(routesFor());
    assert.equal(result.action, 'rerun');
    assert.deepEqual(posted(client).filter((call) => call.includes('/rerun')), [`POST /repos/${REPO}/actions/runs/500/rerun`, `POST /repos/${REPO}/actions/runs/600/rerun`]);
    assert.ok(posted(client).includes(`POST /repos/${REPO}/statuses/${HEAD}`));
  });

  it('posts a pending status and re-runs nothing while Codex has not answered', async () => {
    const { result, client } = await nudge(routesFor({ issueComments: [] }));
    assert.equal(result.action, 'wait');
    assert.deepEqual(posted(client), [`POST /repos/${REPO}/statuses/${HEAD}`]);
  });

  it('puts the context, a short description and the run link in the status', async () => {
    const bodies = [];
    const routes = routesFor({ issueComments: [] });
    routes[`POST /repos/${REPO}/statuses/${HEAD}`] = (body) => bodies.push(body);
    await nudge(routes);
    assert.equal(bodies[0].context, STATUS_CONTEXT);
    assert.equal(bodies[0].state, 'pending');
    assert.ok(bodies[0].description.length <= 140);
    assert.equal(bodies[0].target_url, 'https://github.com/o/r/actions/runs/500');
  });

  it('skips while the quick run is still in progress (the completion event comes back)', async () => {
    const { result, client } = await nudge(routesFor({ ciRuns: [run({ status: 'in_progress', conclusion: null })], browserRuns: [] }));
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'in-progress');
    assert.deepEqual(posted(client), []);
  });

  it('skips when the quick checks failed', async () => {
    const { result } = await nudge(routesFor({ ciRuns: [run({ conclusion: 'failure' })] }));
    assert.equal(result.reason, 'quick-checks-did-not-pass');
  });

  it('skips when the heavy jobs already ran in both workflows', async () => {
    const { result, client } = await nudge(routesFor({ jobs: [{ name: 'Build', conclusion: 'success' }], browserJobs: [browserJob('success')] }));
    assert.equal(result.reason, 'already-full');
    assert.deepEqual(posted(client), []);
  });

  it('bugfix: re-runs the browser regression alone when the CI run is already full', async () => {
    const { result, client } = await nudge(routesFor({ jobs: [{ name: 'Build', conclusion: 'success' }] }));
    assert.equal(result.action, 'rerun');
    assert.deepEqual(result.runs, [600]);
    assert.deepEqual(posted(client).filter((call) => call.includes('/rerun')), [`POST /repos/${REPO}/actions/runs/600/rerun`]);
  });

  it('bugfix: still re-runs a finished browser regression while the CI run is in progress', async () => {
    const { result } = await nudge(routesFor({ ciRuns: [run({ status: 'in_progress', conclusion: null })] }));
    assert.equal(result.action, 'rerun');
    assert.deepEqual(result.runs, [600]);
  });

  it('re-runs CI only while the browser regression is still running', async () => {
    const { result } = await nudge(routesFor({ browserRuns: [run({ id: 600, run_number: 3, status: 'in_progress', conclusion: null })] }));
    assert.equal(result.action, 'rerun');
    assert.deepEqual(result.runs, [500]);
  });

  it('re-runs CI only when there is no browser run for the head', async () => {
    const { result } = await nudge(routesFor({ browserRuns: [] }));
    assert.deepEqual(result.runs, [500]);
  });

  it('does nothing while both workflows are still running', async () => {
    const running = { status: 'in_progress', conclusion: null };
    const { result } = await nudge(routesFor({ ciRuns: [run(running)], browserRuns: [run({ id: 600, run_number: 3, ...running })] }));
    assert.equal(result.reason, 'in-progress');
  });

  it('does not re-run the browser regression when the quick checks failed', async () => {
    const { result } = await nudge(routesFor({ ciRuns: [run({ conclusion: 'failure' })] }));
    assert.equal(result.reason, 'quick-checks-did-not-pass');
  });

  it('does not treat a skipped Build as proof that the full CI ran', async () => {
    const { result } = await nudge(routesFor({ jobs: [{ name: 'Build', conclusion: 'skipped' }] }));
    assert.equal(result.action, 'rerun');
  });

  it('stops re-running after the attempt cap', async () => {
    const { result, client } = await nudge(routesFor({ ciRuns: [run({ run_attempt: MAX_ATTEMPTS })], browserRuns: [run({ id: 600, run_number: 3, run_attempt: MAX_ATTEMPTS })] }));
    assert.equal(result.reason, 'attempt-cap');
    assert.deepEqual(posted(client).filter((call) => call.includes('/rerun')), []);
  });

  it('skips when there is no run for the current head (a newer push is coming)', async () => {
    const { result } = await nudge(routesFor({ ciRuns: [] }));
    assert.equal(result.reason, 'no-ci-run-for-head');
  });

  it('picks the newest run for the head', async () => {
    const { client } = await nudge(routesFor({ ciRuns: [run({ id: 400, run_number: 4 }), run()] }));
    assert.ok(client.calls.includes(`POST /repos/${REPO}/actions/runs/500/rerun`));
    assert.equal(client.calls.includes(`POST /repos/${REPO}/actions/runs/400/rerun`), false);
  });

  it('does nothing at all when the switch is off', async () => {
    const { result, client } = await nudge(routesFor(), { mode: undefined });
    assert.equal(result.reason, 'mode-off');
    assert.deepEqual(client.calls, []);
  });

  it('reads the switch case-insensitively', async () => {
    const { result } = await nudge(routesFor(), { mode: 'ON' });
    assert.equal(result.action, 'rerun');
  });

  it('ignores fork, closed and non-main pull requests', async () => {
    assert.equal((await nudge(routesFor({ pr: pullRequest({ head: { sha: HEAD, repo: { full_name: 'x/fork' } } }) }))).result.reason, 'fork');
    assert.equal((await nudge(routesFor({ pr: pullRequest({ state: 'closed' }) }))).result.reason, 'closed');
    assert.equal((await nudge(routesFor({ pr: pullRequest({ base: { ref: 'release' } }) }))).result.reason, 'not-main');
  });

  it('reports what it would do on a dry run without posting', async () => {
    const { result, client } = await nudge(routesFor(), { dryRun: true });
    assert.equal(result.action, 'rerun');
    assert.deepEqual(posted(client), []);
  });

  it('waits a little longer than the run itself before a timeout re-run, so the run never disagrees', async () => {
    const stale = run({ created_at: '2026-11-11T12:59:00Z' });
    const early = await nudge(routesFor({ issueComments: [], ciRuns: [stale] }));
    assert.equal(early.result.action, 'wait');
    const old = run({ created_at: '2026-11-11T12:56:00Z' });
    const late = await nudge(routesFor({ issueComments: [], ciRuns: [old] }));
    assert.equal(late.result.action, 'rerun');
  });
});

describe('sweepRecentRuns', () => {
  const since = '2026-11-11T08:00:00.000Z';
  const sweepPath = `/repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&status=completed&created=${encodeURIComponent(`>=${since}`)}`;

  it('visits the newest successful run of each pull request and survives a failing one', async () => {
    const routes = {
      ...routesFor(),
      [`GET ${sweepPath}`]: [
        run({ id: 1, run_number: 1, pull_requests: [{ number: 7 }] }),
        run({ id: 2, run_number: 2, pull_requests: [{ number: 7 }] }),
        run({ id: 3, run_number: 3, conclusion: 'failure', pull_requests: [{ number: 8 }] }),
        run({ id: 4, run_number: 4, pull_requests: [{ number: 9 }] }),
        run({ id: 5, run_number: 5, pull_requests: [] }),
      ],
    };
    const client = fakeGithub(routes);
    const seen = [];
    const results = await sweepRecentRuns({
      client,
      repository: REPO,
      since,
      nudge: async (prNumber) => {
        seen.push(prNumber);
        if (prNumber === 9) throw new Error('boom');
        return { action: 'wait', reason: 'x' };
      },
      log: () => {},
    });
    assert.deepEqual(seen, [7, 9]);
    assert.equal(results.length, 2);
    assert.equal(results[1].action, 'error');
  });
});

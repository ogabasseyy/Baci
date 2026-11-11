import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isCiNowCommand, pullRequestTargets, runNudge } from './nudge-cli.mjs';
import { HEAD, NOW, REPO, codexRoutes, fakeGithub, fixture } from './test-support.mjs';

const comment = (body, association = 'OWNER') => ({ issue: { number: 7, pull_request: {} }, comment: { body, author_association: association, user: { login: 'someone' } } });

describe('pullRequestTargets', () => {
  it('reads the pull request of a comment, and ignores plain issues', () => {
    assert.deepEqual(pullRequestTargets('issue_comment', comment('hi')), [7]);
    assert.deepEqual(pullRequestTargets('issue_comment', { issue: { number: 3 }, comment: {} }), []);
  });

  it('reads the pull request of a label event', () => {
    assert.deepEqual(pullRequestTargets('pull_request_target', { pull_request: { number: 12 } }), [12]);
  });

  it('reads the pull requests attached to a finished run', () => {
    assert.deepEqual(pullRequestTargets('workflow_run', { workflow_run: { pull_requests: [{ number: 4 }, { number: 5 }] } }), [4, 5]);
    assert.deepEqual(pullRequestTargets('workflow_run', { workflow_run: { pull_requests: [] } }), []);
  });

  it('sweeps on the schedule and for a manual run without a number', () => {
    assert.equal(pullRequestTargets('schedule', {}), 'sweep');
    assert.equal(pullRequestTargets('workflow_dispatch', { inputs: {} }), 'sweep');
    assert.equal(pullRequestTargets('workflow_dispatch', { inputs: { pr_number: '' } }), 'sweep');
  });

  it('takes a number from a manual run', () => {
    assert.deepEqual(pullRequestTargets('workflow_dispatch', { inputs: { pr_number: '42' } }), [42]);
    assert.deepEqual(pullRequestTargets('workflow_dispatch', { inputs: { pr_number: 'abc' } }), []);
  });

  it('ignores events it does not know', () => {
    assert.deepEqual(pullRequestTargets('push', {}), []);
  });
});

describe('isCiNowCommand', () => {
  it('accepts /ci-now from the owner, members and collaborators', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      assert.equal(isCiNowCommand(comment('/ci-now please', association)), true);
    }
  });

  it('refuses everyone else and other text', () => {
    assert.equal(isCiNowCommand(comment('/ci-now', 'NONE')), false);
    assert.equal(isCiNowCommand(comment('/ci-now', 'CONTRIBUTOR')), false);
    assert.equal(isCiNowCommand(comment('please /ci-now')), false);
    assert.equal(isCiNowCommand({}), false);
  });
});

describe('runNudge', () => {
  const write = (payload) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'nudge-')), 'event.json');
    writeFileSync(file, JSON.stringify(payload));
    return file;
  };
  const env = (eventName, payload, extra = {}) => ({ EVENT_NAME: eventName, GITHUB_EVENT_PATH: write(payload), GITHUB_REPOSITORY: REPO, BACI_REVIEW_FIRST_CI: 'on', ...extra });
  const summaryClean = { ...fixture('codex-summary-clean.json'), updated_at: '2026-11-11T13:00:00Z' };
  const ciRunsPath = `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=pull_request`;
  const routes = () => ({
    ...codexRoutes({ issueComments: [summaryClean] }),
    [`GET ${ciRunsPath}`]: [{ id: 500, run_number: 1, run_attempt: 1, status: 'completed', conclusion: 'success', created_at: '2026-11-11T13:30:00Z', html_url: 'u' }],
    [`GET /repos/${REPO}/actions/workflows/checkout-browser.yml/runs?head_sha=${HEAD}&event=pull_request`]: [],
    [`GET /repos/${REPO}/actions/runs/500/jobs?filter=latest`]: [],
    [`POST /repos/${REPO}/actions/runs/500/rerun`]: {},
    [`POST /repos/${REPO}/statuses/${HEAD}`]: {},
    [`POST /repos/${REPO}/issues/7/labels`]: {},
  });

  it('re-runs when a Codex comment event arrives and the verdict is clean', async () => {
    const client = fakeGithub(routes());
    const results = await runNudge({ env: env('issue_comment', comment('x', 'NONE')), client, now: Date.parse(NOW), log: () => {} });
    assert.equal(results[0].action, 'rerun');
    assert.ok(client.calls.includes(`POST /repos/${REPO}/actions/runs/500/rerun`));
  });

  it('turns /ci-now into the ci-now label first', async () => {
    const client = fakeGithub(routes());
    await runNudge({ env: env('issue_comment', comment('/ci-now')), client, now: Date.parse(NOW), log: () => {} });
    const label = client.calls.indexOf(`POST /repos/${REPO}/issues/7/labels`);
    assert.ok(label >= 0);
    assert.ok(label < client.calls.indexOf(`POST /repos/${REPO}/actions/runs/500/rerun`));
  });

  it('does not label for an unauthorised /ci-now', async () => {
    const client = fakeGithub(routes());
    await runNudge({ env: env('issue_comment', comment('/ci-now', 'NONE')), client, now: Date.parse(NOW), log: () => {} });
    assert.equal(client.calls.includes(`POST /repos/${REPO}/issues/7/labels`), false);
  });

  it('reports nothing to do for events without a pull request', async () => {
    const client = fakeGithub({});
    assert.deepEqual(await runNudge({ env: env('workflow_run', { workflow_run: { pull_requests: [] } }), client, now: Date.parse(NOW), log: () => {} }), []);
    assert.deepEqual(client.calls, []);
  });
});

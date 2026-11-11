import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePullRequestStage } from './evaluate-pr-stage.mjs';
import { HEAD, REPO, codexRoutes, fakeGithub, fixture, pullRequest } from './test-support.mjs';

const summaryClean = { ...fixture('codex-summary-clean.json'), updated_at: '2026-11-11T13:00:00Z' };
const receipt = fixture('codex-receipt-clean.json');

const evaluate = (client, overrides = {}) =>
  evaluatePullRequestStage({
    client,
    repository: REPO,
    prNumber: 7,
    headSha: HEAD,
    eventName: 'pull_request',
    mode: 'on',
    ageMinutes: 5,
    timeoutMinutes: 60,
    ...overrides,
  });

describe('evaluatePullRequestStage', () => {
  it('starts the full CI when the summary comment is clean for the head commit', async () => {
    const client = fakeGithub(codexRoutes({ issueComments: [summaryClean] }));
    const { decision } = await evaluate(client);
    assert.equal(decision.stage, 'full');
    assert.equal(decision.code, 'codex-clean');
  });

  it('waits when Codex has not said anything', async () => {
    const client = fakeGithub(codexRoutes());
    const { decision } = await evaluate(client);
    assert.equal(decision.stage, 'quick');
    assert.equal(decision.code, 'waiting');
  });

  it('does not reuse a clean receipt for another commit when the diff changed', async () => {
    const client = fakeGithub({
      ...codexRoutes({ issueComments: [receipt] }),
      [`GET /repos/${REPO}/commits/256f2d6bf4`]: { sha: '256f2d6bf4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      [`GET /repos/${REPO}/compare/main...256f2d6bf4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?per_page=100`]: { files: [{ filename: 'a', sha: '1', status: 'modified' }] },
      [`GET /repos/${REPO}/compare/main...${HEAD}?per_page=100`]: { files: [{ filename: 'a', sha: '2', status: 'modified' }] },
    });
    const { decision } = await evaluate(client);
    assert.equal(decision.stage, 'quick');
  });

  it('reuses a clean receipt for an older commit when the net diff is identical (sync merge)', async () => {
    const files = [{ filename: 'a', sha: '1', status: 'modified' }];
    const client = fakeGithub({
      ...codexRoutes({ issueComments: [receipt] }),
      [`GET /repos/${REPO}/commits/256f2d6bf4`]: { sha: '256f2d6bf4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      [`GET /repos/${REPO}/compare/main...256f2d6bf4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?per_page=100`]: { files },
      [`GET /repos/${REPO}/compare/main...${HEAD}?per_page=100`]: { files },
    });
    const { decision, verdict } = await evaluate(client);
    assert.equal(decision.stage, 'full');
    assert.equal(verdict.carried, true);
  });

  it('stays quick, without reading comments, when the head moved (superseded)', async () => {
    const client = fakeGithub(codexRoutes({ pr: pullRequest({ head: { sha: 'b'.repeat(40), repo: { full_name: REPO } } }) }));
    const { decision } = await evaluate(client);
    assert.equal(decision.code, 'superseded');
    assert.equal(client.calls.some((call) => call.includes('/comments')), false);
  });

  it('honours the ci-now label without reading Codex at all', async () => {
    const client = fakeGithub(codexRoutes({ pr: pullRequest({ labels: [{ name: 'ci-now' }] }) }));
    const { decision } = await evaluate(client);
    assert.equal(decision.stage, 'full');
    assert.equal(decision.code, 'break-glass');
    assert.deepEqual(client.calls, [`GET /repos/${REPO}/pulls/7`]);
  });

  it('pilot mode ignores pull requests without the pilot label', async () => {
    const client = fakeGithub(codexRoutes());
    const { decision } = await evaluate(client, { mode: 'pilot' });
    assert.equal(decision.code, 'pilot-not-selected');
    assert.equal(client.calls.length, 1);
  });

  it('fails closed when the comments cannot be read, then times out into the full CI', async () => {
    const routes = codexRoutes();
    routes[`GET /repos/${REPO}/issues/7/comments`] = new Error('HTTP 502');
    const early = await evaluate(fakeGithub(routes));
    assert.equal(early.decision.stage, 'quick');
    assert.equal(early.decision.code, 'api-error');
    const late = await evaluate(fakeGithub(routes), { ageMinutes: 61 });
    assert.equal(late.decision.code, 'timeout');
  });

  it('fails closed when the pull request itself cannot be read', async () => {
    const { decision } = await evaluate(fakeGithub({ [`GET /repos/${REPO}/pulls/7`]: new Error('HTTP 403') }));
    assert.equal(decision.stage, 'quick');
    assert.equal(decision.code, 'api-error');
  });

  it('passes unrecognised Codex formats through so the run can warn loudly', async () => {
    const odd = { ...fixture('codex-summary-clean.json'), body: '<!-- codex-review-state:v9 {} -->' };
    const { decision } = await evaluate(fakeGithub(codexRoutes({ issueComments: [odd] })));
    assert.equal(decision.stage, 'quick');
    assert.equal(decision.warn, true);
    assert.match(decision.reason, /not understood/);
  });

  it('bugfix: a failed pull request lookup in pilot mode stays quick instead of starting the full CI', async () => {
    const client = fakeGithub({ [`GET /repos/${REPO}/pulls/7`]: new Error('HTTP 502') });
    const { decision } = await evaluate(client, { mode: 'pilot' });
    assert.equal(decision.stage, 'quick');
    assert.equal(decision.code, 'api-error');
    assert.equal(decision.warn, true);
  });

  it('never starts for a closed pull request', async () => {
    const { decision } = await evaluate(fakeGithub(codexRoutes({ pr: pullRequest({ state: 'closed' }), issueComments: [summaryClean] })));
    assert.equal(decision.code, 'closed');
  });
});

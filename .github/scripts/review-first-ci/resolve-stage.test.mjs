import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runResolveStage } from './resolve-stage.mjs';
import { HEAD, NOW, REPO, codexRoutes, fakeGithub, fixture, pullRequest } from './test-support.mjs';

const summaryClean = { ...fixture('codex-summary-clean.json'), updated_at: '2026-11-11T13:00:00Z' };

function setup({ routes = codexRoutes(), event, env = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-first-'));
  const eventPath = path.join(dir, 'event.json');
  const output = path.join(dir, 'output');
  const summary = path.join(dir, 'summary');
  writeFileSync(
    eventPath,
    JSON.stringify(
      event ?? {
        pull_request: { number: 7, updated_at: '2026-11-11T13:55:00Z', head: { sha: HEAD, repo: { full_name: REPO } } },
      }
    )
  );
  writeFileSync(output, '');
  writeFileSync(summary, '');
  const logs = [];
  const client = fakeGithub(routes);
  const run = () =>
    runResolveStage({
      env: {
        EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: REPO,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        BACI_REVIEW_FIRST_CI: 'on',
        ...env,
      },
      client,
      now: Date.parse(NOW),
      log: (line) => logs.push(line),
    });
  const read = (file) => readFileSync(file, 'utf8');
  return { run, logs, client, outputs: () => Object.fromEntries(read(output).trim().split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2))), summary: () => read(summary) };
}

describe('runResolveStage', () => {
  it('writes stage=full when Codex is clean for the head commit', async () => {
    const t = setup({ routes: codexRoutes({ issueComments: [summaryClean] }) });
    await t.run();
    assert.equal(t.outputs().stage, 'full');
    assert.equal(t.outputs().code, 'codex-clean');
    assert.match(t.summary(), /full CI/i);
  });

  it('writes stage=quick and a notice while waiting', async () => {
    const t = setup();
    await t.run();
    assert.equal(t.outputs().stage, 'quick');
    assert.equal(t.outputs().code, 'waiting');
    assert.ok(t.logs.some((line) => line.startsWith('::notice')));
    assert.match(t.summary(), /ci-now/);
  });

  it('prints a warning annotation when it fails closed', async () => {
    const routes = codexRoutes();
    routes[`GET /repos/${REPO}/issues/7/comments`] = new Error('HTTP 502');
    const t = setup({ routes });
    await t.run();
    assert.equal(t.outputs().stage, 'quick');
    assert.equal(t.outputs().code, 'api-error');
    assert.ok(t.logs.some((line) => line.startsWith('::warning')));
  });

  it('measures the wait from the pull request update time carried in the event', async () => {
    const event = { pull_request: { number: 7, updated_at: '2026-11-11T12:00:00Z', head: { sha: HEAD, repo: { full_name: REPO } } } };
    const t = setup({ event });
    await t.run();
    assert.equal(t.outputs().code, 'timeout');
    assert.equal(t.outputs().stage, 'full');
  });

  it('takes the timeout from the environment and ignores nonsense', async () => {
    const event = { pull_request: { number: 7, updated_at: '2026-11-11T13:45:00Z', head: { sha: HEAD, repo: { full_name: REPO } } } };
    const short = setup({ event, env: { BACI_CODEX_WAIT_TIMEOUT_MINUTES: '10' } });
    await short.run();
    assert.equal(short.outputs().code, 'timeout');
    const nonsense = setup({ event, env: { BACI_CODEX_WAIT_TIMEOUT_MINUTES: 'soon' } });
    await nonsense.run();
    assert.equal(nonsense.outputs().code, 'waiting');
  });

  it('keeps a pull request from a fork on the full CI without calling the API', async () => {
    const event = { pull_request: { number: 7, updated_at: NOW, head: { sha: HEAD, repo: { full_name: 'someone/fork' } } } };
    const t = setup({ event });
    await t.run();
    assert.equal(t.outputs().stage, 'full');
    assert.equal(t.outputs().code, 'fork');
    assert.equal(t.client.calls.length, 0);
  });

  it('puts a one-line reason in the output even when the reason has newlines', async () => {
    const odd = { ...fixture('codex-summary-clean.json'), body: '<!-- codex-review-state:v9 {} -->\nmore' };
    const t = setup({ routes: codexRoutes({ issueComments: [odd] }) });
    await t.run();
    assert.equal(t.outputs().reason.includes('\n'), false);
  });

  it('honours pilot mode through the live labels', async () => {
    const labelled = setup({ env: { BACI_REVIEW_FIRST_CI: 'pilot' }, routes: codexRoutes({ pr: pullRequest({ labels: [{ name: 'review-first-ci' }] }) }) });
    await labelled.run();
    assert.equal(labelled.outputs().stage, 'quick');
    const unlabelled = setup({ env: { BACI_REVIEW_FIRST_CI: 'pilot' } });
    await unlabelled.run();
    assert.equal(unlabelled.outputs().stage, 'full');
    assert.equal(unlabelled.outputs().code, 'pilot-not-selected');
  });
});

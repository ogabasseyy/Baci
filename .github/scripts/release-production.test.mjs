import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import {
  assertCanonicalOriginPushUrls,
  assertCleanWorkerDeployEnv,
  assertRemovableLockPath,
  assertVercelAccess,
  originRepoSlug,
  parseGhJqString,
  readRuns,
  readWorkflowRunStatus,
  RUNS_MAX_PAGES,
  shouldHoldReleaseLock,
  waitForRunCompletion,
} from './release-production.mjs';

test('accepts every canonical GitHub remote spelling', () => {
  for (const remote of [
    'https://github.com/ogabasseyy/Baci.git',
    'https://github.com/ogabasseyy/Baci',
    'git@github.com:ogabasseyy/Baci.git',
    'git@github.com:ogabasseyy/Baci',
    'ssh://git@github.com/ogabasseyy/Baci.git',
    'https://github.com/Ogabasseyy/baci.git',
    'https://github.com/ogabasseyy/Baci/',
    'https://github.com/ogabasseyy/Baci.git/',
    'git@github.com:ogabasseyy/Baci.git/',
    'https://x-access-token:sekret@github.com/ogabasseyy/Baci.git',
    'https://ogabasseyy:sekret@github.com/ogabasseyy/Baci',
  ]) {
    assert.equal(originRepoSlug(remote), 'ogabasseyy/baci');
  }
});

test('reads raw gh --jq scalars without JSON parsing', () => {
  assert.equal(parseGhJqString('in_progress\n', 'test status'), 'in_progress');
  for (const output of ['', '   ', 'null', null, undefined]) {
    assert.throws(() => parseGhJqString(output, 'test status'), /test status unreadable/);
  }
  const calls = [];
  const status = readWorkflowRunStatus(
    args => {
      calls.push(args);
      return 'queued\n';
    },
    42
  );
  assert.equal(status, 'queued');
  assert.ok(calls[0].join(' ').includes('.status // empty'));
  assert.throws(() => readWorkflowRunStatus(() => '', 42), /workflow run 42 status unreadable/);
});

test('requires authenticated Vercel access to the production project', () => {
  assert.doesNotThrow(() => assertVercelAccess(() => 'dpl_abc123'));
  assert.throws(() => assertVercelAccess(() => {
    throw new Error('vercel failed');
  }), {
    message: 'operator Vercel CLI must provide `vercel api` (>= 50.5.1) with production project access; upgrade vercel or re-authenticate and retry',
  });
});

test('waits for run completion by polling the run endpoint', async () => {
  const waits = [];
  const sleeps = [];
  const statuses = ['queued', 'in_progress', 'completed'];
  await waitForRunCompletion(42, async () => statuses.shift() ?? 'completed', {
    pollMs: 10,
    timeoutMs: 60000,
    sleep: async ms => { sleeps.push(ms); },
    onWait: (status, elapsedMs) => { waits.push([status, elapsedMs]); },
  });
  assert.deepEqual(sleeps, [10, 10]);
  assert.deepEqual(waits.map(([status]) => status), ['queued', 'in_progress']);
  await assert.rejects(
    waitForRunCompletion(42, async () => 'in_progress', { timeoutMs: 0, sleep: async () => {} }),
    /timed out waiting for workflow run 42/
  );
});

test('paginates run listing with one bounded call per page', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-fake-gh-'));
  const log = join(directory, 'calls.log');
  writeFileSync(
    join(directory, 'gh'),
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const endpoint = process.argv[3];
appendFileSync(${JSON.stringify(log)}, endpoint + '\\n');
if (process.env.FAKE_GH_ERROR) {
  process.stdout.write(process.env.FAKE_GH_ERROR);
  process.exit(0);
}
if (process.env.FAKE_GH_EXIT) {
  process.stdout.write(process.env.FAKE_GH_STDOUT ?? '');
  process.exit(Number(process.env.FAKE_GH_EXIT));
}
const page = Number(/[?&]page=(\\d+)/.exec(endpoint)[1]);
const counts = process.env.FAKE_GH_PAGES.split(',').map(Number);
const runs = Array.from({ length: counts[page - 1] ?? 0 }, (_, i) => ({
  id: page * 1000 + i, head_sha: 'b'.repeat(40), status: 'queued',
  event: 'workflow_dispatch', display_title: 't', oversized_raw_payload: 'x'.repeat(4096),
}));
process.stdout.write(JSON.stringify({ workflow_runs: runs }));
`,
    { mode: 0o755 }
  );
  const savedPath = process.env.PATH;
  const savedPages = process.env.FAKE_GH_PAGES;
  const savedError = process.env.FAKE_GH_ERROR;
  const savedExit = process.env.FAKE_GH_EXIT;
  const savedStdout = process.env.FAKE_GH_STDOUT;
  process.env.PATH = `${directory}${delimiter}${savedPath}`;
  try {
    process.env.FAKE_GH_PAGES = '100,3';
    const runs = readRuns('status=queued', true);
    assert.equal(runs.length, 103);
    assert.deepEqual(Object.keys(runs[0]).sort(), ['databaseId', 'event', 'headSha', 'status', 'title']);
    assert.equal(runs[102].databaseId, 2002);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 2);
    assert.ok(!calls.some(call => call.includes('--paginate')));

    writeFileSync(log, '');
    process.env.FAKE_GH_PAGES = '100,100,100,100,100,100';
    assert.equal(readRuns('status=queued', true).length, RUNS_MAX_PAGES * 100);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, RUNS_MAX_PAGES);

    writeFileSync(log, '');
    assert.equal(readRuns('status=queued', false).length, 100);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);

    process.env.FAKE_GH_ERROR = '{"message":"rate limited"}';
    assert.throws(() => readRuns('status=queued', true), /no runs payload/);
    delete process.env.FAKE_GH_ERROR;

    process.env.FAKE_GH_EXIT = '1';
    process.env.FAKE_GH_STDOUT = 'HTTP 403: abuse detected';
    assert.throws(() => readRuns('status=queued', true), {
      message: `gh api repos/ogabasseyy/Baci/actions/workflows/deploy.yml/runs?branch=main&per_page=100&page=1&status=queued failed with status 1: HTTP 403: abuse detected; inspect preceding diagnostics`,
    });
  } finally {
    process.env.PATH = savedPath;
    if (savedPages === undefined) delete process.env.FAKE_GH_PAGES;
    else process.env.FAKE_GH_PAGES = savedPages;
    if (savedError === undefined) delete process.env.FAKE_GH_ERROR;
    else process.env.FAKE_GH_ERROR = savedError;
    if (savedExit === undefined) delete process.env.FAKE_GH_EXIT;
    else process.env.FAKE_GH_EXIT = savedExit;
    if (savedStdout === undefined) delete process.env.FAKE_GH_STDOUT;
    else process.env.FAKE_GH_STDOUT = savedStdout;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('requires every push URL to be the canonical repository', () => {
  assert.doesNotThrow(() => assertCanonicalOriginPushUrls('https://github.com/ogabasseyy/Baci.git'));
  assert.doesNotThrow(() =>
    assertCanonicalOriginPushUrls('https://github.com/ogabasseyy/Baci.git\ngit@github.com:ogabasseyy/Baci.git\n')
  );
  for (const pushUrls of [
    '',
    'git@github.com:fork/other.git',
    'https://github.com/ogabasseyy/Baci.git\ngit@github.com:fork/other.git',
  ]) {
    assert.throws(() => assertCanonicalOriginPushUrls(pushUrls), /canonical repository/);
  }
});

test('refuses inherited worker-deploy safety overrides', () => {
  assert.doesNotThrow(() => assertCleanWorkerDeployEnv({}));
  assert.doesNotThrow(() =>
    assertCleanWorkerDeployEnv({ BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '0', BACI_DEPLOY_WORKFLOW_REPO: '' })
  );
  assert.throws(
    () => assertCleanWorkerDeployEnv({ BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '1' }),
    /BACI_DEPLOY_SKIP_INFLIGHT_CHECK/
  );
  assert.throws(
    () => assertCleanWorkerDeployEnv({ BACI_DEPLOY_WORKFLOW_REPO: 'fork/other' }),
    /BACI_DEPLOY_WORKFLOW_REPO/
  );
});

test('holds the lock only on indeterminate dispatches', () => {
  assert.equal(shouldHoldReleaseLock(Object.assign(new Error('x'), { indeterminateDispatch: true })), true);
  assert.equal(shouldHoldReleaseLock(new Error('x')), false);
  assert.equal(shouldHoldReleaseLock(null), false);
  assert.equal(shouldHoldReleaseLock(undefined), false);
});

test('removes only the leaf lock directory', () => {
  assert.doesNotThrow(() => assertRemovableLockPath('/repo/.git/baci-production-release.lock'));
  for (const lockPath of ['/tmp/evil', '/repo/.git', '/x/baci-production-release.lock/../other']) {
    assert.throws(() => assertRemovableLockPath(lockPath), /unexpected lock path/);
  }
});

test('rejects non-GitHub and non-repository remotes', () => {
  for (const remote of [
    '',
    undefined,
    'https://gitlab.com/ogabasseyy/Baci.git',
    'git@github.com:other/other.git',
    'https://github.com.evil.example/ogabasseyy/Baci.git',
    '/local/path/checkout',
  ]) {
    assert.notEqual(originRepoSlug(remote), 'ogabasseyy/baci');
  }
});

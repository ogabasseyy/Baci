import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTarget, runAssurance } from './money-pr-assurance.mjs';
import {
  createFakeGitHub,
  HEAD,
  loadRawConfig,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';

const config = parseAssuranceConfig(loadRawConfig());
const baseEnv = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPOSITORY: 'o/r',
  GITHUB_API_URL: 'https://api.github.test',
  RUN_URL: 'https://github.test/o/r/actions/runs/1',
};

function prRoute(number, files, extra = {}) {
  return {
    [`GET /repos/o/r/pulls/${number}`]: {
      json: {
        number,
        state: 'open',
        head: { sha: HEAD },
        body: '',
        labels: [],
        changed_files: files.length,
        ...extra,
      },
    },
    [`GET /repos/o/r/pulls/${number}/files?per_page=100`]: { json: files },
  };
}

function statusBodies(fake) {
  return fake.calls
    .filter(({ key }) => key.startsWith('POST /repos/o/r/statuses/'))
    .map(({ body }) => JSON.parse(body));
}

async function run(env, routes) {
  const fake = createFakeGitHub({
    [`POST /repos/o/r/statuses/${HEAD}`]: { status: 201, json: {} },
    ...routes,
  });
  const summaries = [];
  const result = await runAssurance({
    env: { ...baseEnv, ...env },
    fetchImpl: fake.fetch,
    config,
    appendSummary: (text) => summaries.push(text),
    log: () => undefined,
  });
  return { fake, result, summaries };
}

test('targets come from the PR number or the commit SHA, validated', () => {
  assert.deepEqual(resolveTarget({ ...baseEnv, PR_NUMBER: '12' }), {
    owner: 'o',
    repo: 'r',
    prNumber: 12,
    headSha: null,
  });
  assert.deepEqual(
    resolveTarget({ ...baseEnv, PR_NUMBER: '', HEAD_SHA: HEAD }),
    { owner: 'o', repo: 'r', prNumber: null, headSha: HEAD }
  );
  for (const env of [
    { ...baseEnv, PR_NUMBER: '12; rm' },
    { ...baseEnv, PR_NUMBER: '0' },
    { ...baseEnv, HEAD_SHA: 'not-a-sha' },
    { ...baseEnv, GITHUB_REPOSITORY: 'bad' },
    { ...baseEnv },
  ]) {
    assert.throws(
      () => resolveTarget(env),
      /PR_NUMBER|HEAD_SHA|GITHUB_REPOSITORY/
    );
  }
});

test('a non-money PR gets a success status', async () => {
  const { fake, summaries } = await run(
    { PR_NUMBER: '5' },
    prRoute(5, [{ filename: 'apps/web/src/app/page.tsx', status: 'modified' }])
  );
  const [status] = statusBodies(fake);
  assert.equal(status.state, 'success');
  assert.equal(status.context, 'money-pr-assurance');
  assert.match(status.description, /Not a money-path PR/);
  assert.equal(status.target_url, baseEnv.RUN_URL);
  assert.match(summaries.join('\n'), /#5/);
});

test('a money PR without assurance gets a failure status listing the reasons', async () => {
  const routes = {
    ...prRoute(6, [
      {
        filename: 'apps/web/src/lib/piggyvest/transfer.ts',
        status: 'modified',
      },
    ]),
    'GET /repos/o/r/issues/6/comments?per_page=100': { json: [] },
    'GET /repos/o/r/pulls/6/reviews?per_page=100': { json: [] },
    'POST /graphql': {
      json: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] },
            },
          },
        },
      },
    },
    [`GET /repos/o/r/commits/${HEAD}/check-runs?per_page=100`]: {
      json: { check_runs: [] },
    },
  };
  const { fake, result, summaries } = await run({ PR_NUMBER: '6' }, routes);
  const [status] = statusBodies(fake);
  assert.equal(status.state, 'failure');
  assert.equal(
    result.exitCode,
    0,
    'an unmet requirement is a status, not a job failure'
  );
  assert.match(summaries.join('\n'), /No owner-readable summary/);
  assert.match(summaries.join('\n'), /Codex/);
});

test('a commit SHA evaluates every open PR at that head', async () => {
  const routes = {
    [`GET /repos/o/r/commits/${HEAD}/pulls?per_page=100`]: {
      json: [{ number: 8, state: 'open', head: { sha: HEAD } }],
    },
    ...prRoute(8, [{ filename: 'README.md', status: 'modified' }]),
  };
  const { fake, result } = await run({ HEAD_SHA: HEAD }, routes);
  assert.deepEqual(
    result.results.map(({ number }) => number),
    [8]
  );
  assert.equal(statusBodies(fake).length, 1);
});

test('a closed PR is skipped and dry runs post nothing', async () => {
  const closed = await run(
    { PR_NUMBER: '9' },
    prRoute(9, [], { state: 'closed' })
  );
  assert.equal(statusBodies(closed.fake).length, 0);
  const dry = await run(
    { PR_NUMBER: '5', DRY_RUN: '1' },
    prRoute(5, [{ filename: 'apps/web/src/app/page.tsx', status: 'modified' }])
  );
  assert.equal(statusBodies(dry.fake).length, 0);
  assert.equal(dry.result.results[0].state, 'success');
});

test('an API failure posts an error status and fails the job', async () => {
  const routes = {
    ...prRoute(6, [
      {
        filename: 'apps/web/src/lib/piggyvest/transfer.ts',
        status: 'modified',
      },
    ]),
    'GET /repos/o/r/issues/6/comments?per_page=100': {
      status: 502,
      json: { message: 'bad gateway' },
    },
  };
  const { fake, result } = await run({ PR_NUMBER: '6' }, routes);
  const [status] = statusBodies(fake);
  assert.equal(status.state, 'error');
  assert.match(status.description, /could not be evaluated/);
  assert.equal(result.exitCode, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTarget } from './money-pr-assurance.mjs';
import { HEAD, OLD_HEAD } from './money-pr-assurance.test-support.mjs';
import {
  baseEnv,
  prRoute,
  run,
  statusBodies,
} from './money-pr-assurance.run-support.mjs';

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
  // The event's head SHA is kept next to the PR number as a fallback.
  assert.deepEqual(
    resolveTarget({ ...baseEnv, PR_NUMBER: '12', HEAD_SHA: HEAD }),
    { owner: 'o', repo: 'r', prNumber: 12, headSha: HEAD }
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
    prRoute(5, [{ filename: 'apps/web/src/app/page.tsx', status: 'modified', patch: '+// copy' }])
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
    [`GET /repos/o/r/actions/runs?head_sha=${HEAD}&per_page=100`]: {
      json: { workflow_runs: [] },
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
    prRoute(5, [{ filename: 'apps/web/src/app/page.tsx', status: 'modified', patch: '+// copy' }])
  );
  assert.equal(statusBodies(dry.fake).length, 0);
  assert.equal(dry.result.results[0].state, 'success');
});

// Retry and error-status scenarios of the money-pr-assurance runner.
import assert from 'node:assert/strict';
import test from 'node:test';
import { HEAD, OLD_HEAD } from './money-pr-assurance.test-support.mjs';
import {
  flakyPullRoute,
  prRoute,
  run,
  statusBodies,
} from './money-pr-assurance.run-support.mjs';

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

test('a transient failure reading the PR is retried with growing waits', async () => {
  const { fake, result, sleeps } = await run(
    { PR_NUMBER: '5' },
    flakyPullRoute(5, 2, [
      { filename: 'apps/web/src/app/page.tsx', status: 'modified' },
    ])
  );
  assert.equal(result.exitCode, 0);
  assert.equal(statusBodies(fake)[0].state, 'success');
  assert.deepEqual(sleeps, [2000, 4000]);
});

test('if the PR cannot be read, an error replaces any status on the event head', async () => {
  const { fake, result } = await run(
    { PR_NUMBER: '5', HEAD_SHA: OLD_HEAD },
    flakyPullRoute(5, 99, [])
  );
  assert.equal(result.exitCode, 1);
  const posts = fake.calls.filter(({ key }) => key.includes('/statuses/'));
  assert.deepEqual(
    posts.map(({ key }) => key),
    [`POST /repos/o/r/statuses/${OLD_HEAD}`]
  );
  assert.equal(JSON.parse(posts[0].body).state, 'error');
  // Without an event head SHA there is nothing safe to post to.
  const blind = await run({ PR_NUMBER: '5' }, flakyPullRoute(5, 99, []));
  assert.equal(blind.result.exitCode, 1);
  assert.equal(statusBodies(blind.fake).length, 0);
});

test('if the PR list for a commit cannot be read, the commit gets an error', async () => {
  const { fake, result } = await run(
    { HEAD_SHA: HEAD },
    {
      [`GET /repos/o/r/commits/${HEAD}/pulls?per_page=100`]: {
        status: 502,
        json: {},
      },
    }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(statusBodies(fake)[0].state, 'error');
});

test('a comment-triggered run that cannot read the PR still marks its head', async () => {
  // Issue comments carry no head SHA; the head is looked up over GraphQL.
  const routes = {
    ...flakyPullRoute(5, 99, []),
    'POST /graphql': {
      json: {
        data: { repository: { pullRequest: { headRefOid: OLD_HEAD } } },
      },
    },
  };
  const { fake, result } = await run({ PR_NUMBER: '5' }, routes);
  assert.equal(result.exitCode, 1);
  const posts = fake.calls.filter(({ key }) => key.includes('/statuses/'));
  assert.deepEqual(
    posts.map(({ key }) => key),
    [`POST /repos/o/r/statuses/${OLD_HEAD}`]
  );
  assert.equal(JSON.parse(posts[0].body).state, 'error');
});

test('a transient failure while collecting the snapshot is retried', async () => {
  let calls = 0;
  const routes = {
    ...prRoute(6, [
      {
        filename: 'apps/web/src/lib/piggyvest/transfer.ts',
        status: 'modified',
      },
    ]),
    'GET /repos/o/r/issues/6/comments?per_page=100': () => {
      calls += 1;
      return calls === 1 ? { status: 502, json: {} } : { json: [] };
    },
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
    [`GET /repos/o/r/actions/runs?head_sha=${HEAD}&per_page=100`]: {
      json: { workflow_runs: [] },
    },
    [`GET /repos/o/r/commits/${HEAD}/check-runs?per_page=100`]: {
      json: { check_runs: [] },
    },
  };
  const { fake, result, sleeps } = await run({ PR_NUMBER: '6' }, routes);
  assert.equal(result.exitCode, 0);
  assert.equal(statusBodies(fake)[0].state, 'failure');
  assert.deepEqual(sleeps, [2000]);
});

// Flaky routes answer 502 for their first `failures` calls.
function flaky(failures, answer) {
  let calls = 0;
  return () => {
    calls += 1;
    return calls <= failures ? { status: 502, json: {} } : answer;
  };
}

const headLookup = {
  json: { data: { repository: { pullRequest: { headRefOid: OLD_HEAD } } } },
};

test('on every trigger path, a run that cannot read the PR replaces the head status with an error', async () => {
  // How each workflow event reaches the script (see money-pr-assurance.yml).
  const triggers = [
    ['pull_request_target', { PR_NUMBER: '5', HEAD_SHA: OLD_HEAD }],
    [
      'workflow_run (CI or review relay)',
      { PR_NUMBER: '5', HEAD_SHA: OLD_HEAD },
    ],
    ['issue_comment', { PR_NUMBER: '5' }],
    ['workflow_dispatch', { PR_NUMBER: '5' }],
  ];
  for (const [name, env] of triggers) {
    const { fake, result } = await run(env, {
      ...flakyPullRoute(5, 99, []),
      // The second route to the head is flaky too, and is retried.
      'POST /graphql': flaky(2, headLookup),
      // So is posting the error itself.
      [`POST /repos/o/r/statuses/${OLD_HEAD}`]: flaky(2, {
        status: 201,
        json: {},
      }),
    });
    assert.equal(result.exitCode, 1, name);
    const posted = fake.calls
      .filter(({ key }) => key === `POST /repos/o/r/statuses/${OLD_HEAD}`)
      .map(({ body }) => JSON.parse(body).state);
    assert.deepEqual(posted, ['error', 'error', 'error'], name);
  }
});

test('a transient failure posting the result status is retried', async () => {
  const { fake, result, sleeps } = await run(
    { PR_NUMBER: '5' },
    {
      ...prRoute(5, [
        { filename: 'apps/web/src/app/page.tsx', status: 'modified' },
      ]),
      [`POST /repos/o/r/statuses/${HEAD}`]: flaky(1, {
        status: 201,
        json: {},
      }),
    }
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    statusBodies(fake).map(({ state }) => state),
    ['success', 'success']
  );
  assert.deepEqual(sleeps, [2000]);
});

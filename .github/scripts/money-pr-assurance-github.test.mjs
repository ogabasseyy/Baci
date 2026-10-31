import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFakeGitHub,
  HEAD,
  loadRawConfig,
  SUMMARY_PATH,
  validSummary,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  collectSnapshot,
  createGitHubClient,
  findOpenPullRequestsForSha,
  postStatus,
} from './money-pr-assurance-github.mjs';

const config = parseAssuranceConfig(loadRawConfig());
const target = { owner: 'o', repo: 'r', number: 7 };

test('REST pagination follows Link headers and sends the token', async () => {
  const fake = createFakeGitHub({
    'GET /repos/o/r/issues/7/comments?per_page=100': {
      json: [{ id: 1 }],
      link: '<https://api.github.test/repos/o/r/issues/7/comments?per_page=100&page=2>; rel="next"',
    },
    'GET /repos/o/r/issues/7/comments?per_page=100&page=2': {
      json: [{ id: 2 }],
    },
  });
  const client = createGitHubClient({
    token: 'test-token',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  assert.deepEqual(
    await client.getAll('/repos/o/r/issues/7/comments?per_page=100'),
    [{ id: 1 }, { id: 2 }]
  );
  assert.equal(fake.calls[0].headers.authorization, 'Bearer test-token');
});

test('pagination refuses to follow a next link to another host', async () => {
  const fake = createFakeGitHub({
    'GET /repos/o/r/issues/7/comments?per_page=100': {
      json: [{ id: 1 }],
      link: '<https://elsewhere.test/steal>; rel="next"',
    },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  await assert.rejects(
    client.getAll('/repos/o/r/issues/7/comments?per_page=100'),
    /unexpected pagination host/
  );
});

test('API errors surface without echoing the token', async () => {
  const fake = createFakeGitHub({
    'GET /repos/o/r/pulls/7': { status: 500, json: { message: 'boom' } },
  });
  const client = createGitHubClient({
    token: 'secret-value',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  await assert.rejects(client.request('GET', '/repos/o/r/pulls/7'), (error) => {
    assert.match(error.message, /GET \/repos\/o\/r\/pulls\/7 failed with 500/);
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});

test('GraphQL errors are raised', async () => {
  const fake = createFakeGitHub({
    'POST /graphql': { json: { errors: [{ message: 'bad query' }] } },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  await assert.rejects(client.graphql('query { x }', {}), /bad query/);
});

test('a non-money PR snapshot skips review, thread and check reads', async () => {
  const fake = createFakeGitHub({
    'GET /repos/o/r/pulls/7': {
      json: {
        number: 7,
        state: 'open',
        head: { sha: HEAD },
        body: null,
        labels: [],
        changed_files: 1,
      },
    },
    'GET /repos/o/r/pulls/7/files?per_page=100': {
      json: [{ filename: 'apps/web/src/app/page.tsx', status: 'modified' }],
    },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  const snapshot = await collectSnapshot(client, target, config);
  assert.equal(snapshot.pr.headSha, HEAD);
  assert.equal(snapshot.pr.body, '');
  assert.equal(snapshot.comments, undefined);
  assert.equal(fake.calls.length, 2);
});

test('a money PR snapshot normalises every source', async () => {
  const fake = createFakeGitHub({
    'GET /repos/o/r/pulls/7': {
      json: {
        number: 7,
        state: 'open',
        head: { sha: HEAD },
        body: 'Sandbox evidence: docs/piggyvest-contract-evidence/2026-10-31.md',
        labels: [{ name: 'owner-signoff' }],
        changed_files: 2,
      },
    },
    'GET /repos/o/r/pulls/7/files?per_page=100': {
      json: [
        { filename: 'apps/web/src/lib/piggyvest/a.ts', status: 'modified' },
        {
          filename: SUMMARY_PATH,
          status: 'added',
          previous_filename: undefined,
        },
      ],
    },
    'GET /repos/o/r/issues/7/comments?per_page=100': {
      json: [
        {
          id: 1,
          user: { login: 'claude[bot]', type: 'Bot' },
          body: 'hi',
          created_at: 'c',
          updated_at: 'u',
        },
      ],
    },
    'GET /repos/o/r/pulls/7/reviews?per_page=100': {
      json: [
        {
          id: 2,
          user: { login: 'x', type: 'User' },
          body: null,
          commit_id: HEAD,
          state: 'COMMENTED',
          submitted_at: 's',
        },
      ],
    },
    'POST /graphql': {
      json: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ isResolved: false, isOutdated: true, path: 'a.ts' }],
              },
            },
          },
        },
      },
    },
    [`GET /repos/o/r/commits/${HEAD}/check-runs?per_page=100`]: {
      json: {
        check_runs: [
          {
            id: 3,
            name: 'Quality Gate',
            status: 'completed',
            conclusion: 'success',
            started_at: 't',
          },
        ],
      },
    },
    [`GET /repos/o/r/contents/${SUMMARY_PATH}?ref=${HEAD}`]: {
      text: validSummary(),
    },
    [`GET /repos/o/r/contents/docs/piggyvest-contract-evidence/2026-10-31.md?ref=${HEAD}`]:
      { status: 404, json: {} },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  const snapshot = await collectSnapshot(client, target, config);
  assert.deepEqual(snapshot.pr.labels, ['owner-signoff']);
  assert.deepEqual(snapshot.comments[0], {
    id: 1,
    login: 'claude[bot]',
    userType: 'Bot',
    body: 'hi',
    createdAt: 'c',
    updatedAt: 'u',
  });
  assert.equal(snapshot.reviews[0].body, '');
  assert.equal(snapshot.reviews[0].commitId, HEAD);
  assert.deepEqual(snapshot.threads, [
    { isResolved: false, isOutdated: true, path: 'a.ts' },
  ]);
  assert.equal(snapshot.checkRuns[0].name, 'Quality Gate');
  assert.equal(snapshot.summaries[SUMMARY_PATH], validSummary());
  assert.deepEqual(snapshot.evidenceExists, {
    'docs/piggyvest-contract-evidence/2026-10-31.md': false,
  });
});

test('statuses are posted to the head commit with a bounded description', async () => {
  const fake = createFakeGitHub({
    [`POST /repos/o/r/statuses/${HEAD}`]: { status: 201, json: {} },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  await postStatus(client, {
    owner: 'o',
    repo: 'r',
    sha: HEAD,
    state: 'failure',
    description: 'x'.repeat(200),
    context: 'money-pr-assurance',
    targetUrl: 'https://run',
  });
  const sent = JSON.parse(fake.calls[0].body);
  assert.equal(sent.context, 'money-pr-assurance');
  assert.equal(sent.state, 'failure');
  assert.equal(sent.description.length, 140);
  assert.equal(sent.target_url, 'https://run');
});

test('open PRs are found for a commit and closed ones ignored', async () => {
  const fake = createFakeGitHub({
    [`GET /repos/o/r/commits/${HEAD}/pulls?per_page=100`]: {
      json: [
        { number: 1, state: 'open', head: { sha: HEAD } },
        { number: 2, state: 'closed', head: { sha: HEAD } },
        { number: 3, state: 'open', head: { sha: 'f'.repeat(40) } },
      ],
    },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  assert.deepEqual(
    await findOpenPullRequestsForSha(client, {
      owner: 'o',
      repo: 'r',
      sha: HEAD,
    }),
    [1]
  );
});

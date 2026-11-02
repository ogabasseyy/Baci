// The REST API credits an edited comment to its original author, so the
// assurance reads who last edited each trusted comment or review.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUDE,
  CODEX,
  comment,
  createFakeGitHub,
  loadRawConfig,
  OWNER,
  review,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  attachEditors,
  trustedLogins,
  UNKNOWN_EDITOR,
} from './money-pr-assurance-editors.mjs';
import { createGitHubClient } from './money-pr-assurance-github.mjs';

const config = parseAssuranceConfig(loadRawConfig());

function clientFor(nodes) {
  const fake = createFakeGitHub({
    'POST /graphql': ({ body }) => {
      const { variables } = JSON.parse(body);
      return {
        json: {
          data: {
            nodes: variables.ids.map((id) => (id in nodes ? nodes[id] : null)),
          },
        },
      };
    },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  return { client, fake };
}

test('trusted logins are the reviewer apps, the owner and Codex requesters', () => {
  const logins = trustedLogins(config);
  for (const login of [CODEX, CLAUDE, OWNER]) assert.ok(logins.includes(login));
  assert.ok(!logins.includes('github-actions[bot]'));
});

test('editors are read for trusted items and bot logins match REST logins', async () => {
  const items = [
    comment(CLAUDE, 'verdict', 1),
    comment(CODEX, 'clean', 2),
    comment(OWNER, 'approval', 3),
    review(CLAUDE, 'review verdict', 'abc', 4),
    comment('stranger', 'anything', 5),
  ];
  const { client, fake } = clientFor({
    IC_1001: {
      id: 'IC_1001',
      lastEditedAt: 't',
      editor: { __typename: 'Bot', login: 'claude' },
    },
    IC_1002: { id: 'IC_1002', lastEditedAt: null, editor: null },
    IC_1003: {
      id: 'IC_1003',
      lastEditedAt: 't',
      editor: { __typename: 'User', login: OWNER },
    },
    PRR_2004: {
      id: 'PRR_2004',
      lastEditedAt: 't',
      editor: { __typename: 'User', login: OWNER },
    },
  });
  const result = await attachEditors(client, items, trustedLogins(config));
  assert.deepEqual(
    result.map(({ editor }) => editor),
    [CLAUDE, null, OWNER, OWNER, UNKNOWN_EDITOR]
  );
  const graphqlCalls = fake.calls.filter(({ key }) => key === 'POST /graphql');
  assert.equal(graphqlCalls.length, 1);
  assert.deepEqual(JSON.parse(graphqlCalls[0].body).variables.ids, [
    'IC_1001',
    'IC_1002',
    'IC_1003',
    'PRR_2004',
  ]);
});

test('an edit whose editor is hidden, or a node that cannot be read, is unknown', async () => {
  const items = [
    comment(CLAUDE, 'verdict', 1),
    comment(CLAUDE, 'gone', 2),
    comment(CLAUDE, 'no node id', 3, { nodeId: '' }),
  ];
  const { client } = clientFor({
    IC_1001: { id: 'IC_1001', lastEditedAt: 't', editor: null },
  });
  const result = await attachEditors(client, items, trustedLogins(config));
  assert.deepEqual(
    result.map(({ editor }) => editor),
    [UNKNOWN_EDITOR, UNKNOWN_EDITOR, UNKNOWN_EDITOR]
  );
});

test('editor lookups are batched one hundred nodes at a time', async () => {
  const items = Array.from({ length: 150 }, (_, index) =>
    comment(CLAUDE, 'v', index, { nodeId: `IC_${index}` })
  );
  const nodes = Object.fromEntries(
    items.map(({ nodeId }) => [
      nodeId,
      { id: nodeId, lastEditedAt: null, editor: null },
    ])
  );
  const { client, fake } = clientFor(nodes);
  const result = await attachEditors(client, items, trustedLogins(config));
  assert.ok(result.every(({ editor }) => editor === null));
  assert.equal(fake.calls.length, 2);
});

test('no lookup is made when no trusted item exists', async () => {
  const { client, fake } = clientFor({});
  const result = await attachEditors(
    client,
    [comment('stranger', 'x', 1)],
    trustedLogins(config)
  );
  assert.equal(result[0].editor, UNKNOWN_EDITOR);
  assert.equal(fake.calls.length, 0);
});

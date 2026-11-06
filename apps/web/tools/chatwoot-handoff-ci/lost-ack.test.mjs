import assert from 'node:assert/strict';
import test from 'node:test';
import { findSyntheticMessage, reconcileAmbiguousSend } from './lost-ack.mjs';

const recoveredMessage = {
  id: 42,
  content: 'synthetic marker',
  message_type: 1,
  sender: { type: 'user' },
};

test('message lookup paginates backward until the synthetic marker is found', async () => {
  const paths = [];
  const api = (path) => {
    paths.push(path);
    if (paths.length === 1)
      return {
        payload: Array.from({ length: 20 }, (_, index) => ({
          id: 100 - index,
          content: `other ${index}`,
        })),
      };
    return { payload: [recoveredMessage] };
  };

  const matches = await findSyntheticMessage({
    api,
    path: '/api/v1/accounts/7/conversations/12/messages',
    token: 'synthetic-token',
    content: 'synthetic marker',
  });

  assert.deepEqual(matches, [recoveredMessage]);
  assert.deepEqual(paths, [
    '/api/v1/accounts/7/conversations/12/messages',
    '/api/v1/accounts/7/conversations/12/messages?before=81',
  ]);
});

test('a single lookup match reconciles an ambiguous send without retry', async () => {
  let sends = 0;
  const result = await reconcileAmbiguousSend({
    send: () => {
      sends += 1;
      throw new TypeError('fetch failed');
    },
    lookup: () => [recoveredMessage],
  });

  assert.equal(result.recovered, true);
  assert.equal(result.result, recoveredMessage);
  assert.equal(sends, 1);
});

test('an empty lookup leaves the send outcome unknown and does not retry', async () => {
  let sends = 0;
  await assert.rejects(
    reconcileAmbiguousSend({
      send: () => {
        sends += 1;
        throw new TypeError('fetch failed');
      },
      lookup: () => [],
    }),
    /remains unknown.*not retried/
  );
  assert.equal(sends, 1);
});

test('duplicate lookup matches remain unresolved without retry', async () => {
  let sends = 0;
  await assert.rejects(
    reconcileAmbiguousSend({
      send: () => {
        sends += 1;
        throw new TypeError('fetch failed');
      },
      lookup: () => [recoveredMessage, recoveredMessage],
    }),
    /multiple messages matched.*not retried/
  );
  assert.equal(sends, 1);
});

test('a failed lookup leaves outcome unknown and does not retry', async () => {
  let sends = 0;
  await assert.rejects(
    reconcileAmbiguousSend({
      send: () => {
        sends += 1;
        throw new TypeError('fetch failed');
      },
      lookup: () => {
        throw new Error('lookup unavailable');
      },
    }),
    /reconciliation failed.*not retried/
  );
  assert.equal(sends, 1);
});

test('message lookup page cap does not convert an incomplete scan into absence', async () => {
  let page = 0;
  const api = () => {
    const start = 10_000 - page * 20;
    page += 1;
    return {
      payload: Array.from({ length: 20 }, (_, index) => ({
        id: start - index,
        content: 'other',
      })),
    };
  };
  await assert.rejects(
    findSyntheticMessage({
      api,
      path: '/api/v1/accounts/7/conversations/12/messages',
      token: 'synthetic-token',
      content: 'synthetic marker',
    }),
    /page limit/
  );
});

test('message lookup deadline aborts an in-flight API page request', async () => {
  let calls = 0;
  await assert.rejects(
    findSyntheticMessage({
      api: (_path, _token, { signal }) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      },
      path: '/api/v1/accounts/7/conversations/12/messages',
      token: 'synthetic-token',
      content: 'synthetic marker',
      timeoutMs: 10,
    }),
    /timeout/i
  );
  assert.equal(calls, 1);
});

test('definitive provider HTTP errors propagate without reconciliation or retry', async () => {
  let sends = 0;
  let lookups = 0;
  await assert.rejects(
    reconcileAmbiguousSend({
      send: () => {
        sends += 1;
        throw new Error('Chatwoot 422 /messages: invalid payload');
      },
      lookup: () => {
        lookups += 1;
        return [];
      },
    }),
    /Chatwoot 422/
  );
  assert.equal(sends, 1);
  assert.equal(lookups, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { findSyntheticMessage } from './message-lookup.mjs';

const recoveredMessage = {
  id: 42,
  content: 'synthetic marker',
  message_type: 1,
  sender: { type: 'user' },
};

test('paginates backward until the synthetic marker is found', async () => {
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

test('page cap does not convert an incomplete scan into absence', async () => {
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

test('lookup deadline aborts an in-flight API page request', async () => {
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

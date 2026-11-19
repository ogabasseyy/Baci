import assert from 'node:assert/strict';
import test from 'node:test';
import { findSyntheticMessage } from './message-lookup.mjs';

const recoveredMessage = {
  id: 42,
  content: 'synthetic marker',
  message_type: 1,
  sender: { type: 'user' },
};

test('paginates backward until an empty page and finds the synthetic marker', async () => {
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
    if (paths.length === 2) return { payload: [recoveredMessage] };
    return { payload: [] };
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
    '/api/v1/accounts/7/conversations/12/messages?before=42',
  ]);
});

test('continues past a short page to detect duplicates on later pages', async () => {
  const paths = [];
  const warnings = [];
  const api = (path) => {
    paths.push(path);
    if (paths.length === 1)
      return {
        payload: [
          { ...recoveredMessage, id: 50 },
          {
            id: 49,
            content: 'synthetic marker',
            message_type: 0,
            sender: { type: 'contact' },
          },
        ],
      };
    if (paths.length === 2) return { payload: [recoveredMessage] };
    return { payload: [] };
  };

  const matches = await findSyntheticMessage({
    api,
    path: '/api/v1/accounts/7/conversations/12/messages',
    token: 'synthetic-token',
    content: 'synthetic marker',
    onUnexpectedCandidateShape: (details) => warnings.push(details),
  });

  assert.equal(matches.length, 2);
  assert.equal(warnings.length, 1);
  assert.deepEqual(paths, [
    '/api/v1/accounts/7/conversations/12/messages',
    '/api/v1/accounts/7/conversations/12/messages?before=49',
    '/api/v1/accounts/7/conversations/12/messages?before=42',
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

test('page cap fails closed even when an earlier page collected a match', async () => {
  let page = 0;
  const api = () => {
    const start = 10_000 - page * 20;
    page += 1;
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: start - index,
      content: 'other',
    }));
    if (page === 1) items[0] = recoveredMessage;
    return { payload: items };
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

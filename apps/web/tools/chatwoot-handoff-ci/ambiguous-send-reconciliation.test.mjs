import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileAmbiguousSend } from './ambiguous-send-reconciliation.mjs';

const recoveredMessage = {
  id: 42,
  content: 'synthetic marker',
  message_type: 1,
  sender: { type: 'user' },
};

test('a unique lookup match reconciles an ambiguous send without retry', async () => {
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionState } from './refresh.ts';
import { resolveSession } from './refresh.ts';

const state = (): SessionState => ({
  actorUserId: 'owner',
  connectionId: 'connection',
  grantVersion: 1,
  active: true,
  expiresAt: Date.now() + 600000,
  refreshStarted: false,
  tokens: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1 },
});
test('refresh rotates only a dedicated session and verifies stable subject', async () => {
  const row = state();
  let saved = false;
  const result = await resolveSession(row, {
    markRefreshing: async () => {
      row.refreshStarted = true;
    },
    save: async (tokens) => {
      row.tokens = tokens;
      saved = true;
    },
    revoke: async () => {
      row.active = false;
    },
    refresh: async () => ({
      accessToken: 'next',
      refreshToken: 'rotated',
      expiresAt: Date.now() + 120000,
    }),
    verifyUser: async () => 'owner',
  });
  assert.equal(result.accessToken, 'next');
  assert(saved);
});
test('lost refresh result, stale in-flight marker and subject mismatch require reconnect without retry', async () => {
  for (const scenario of ['lost', 'marker', 'subject']) {
    const row = state();
    row.refreshStarted = scenario === 'marker';
    let refreshes = 0;
    await assert.rejects(
      resolveSession(row, {
        markRefreshing: async () => {},
        save: async () => {
          throw new Error('must not save');
        },
        revoke: async () => {
          row.active = false;
        },
        refresh: async () => {
          refreshes++;
          if (scenario === 'lost') throw new Error('private provider message');
          return {
            accessToken: 'other',
            refreshToken: 'other',
            expiresAt: Date.now() + 120000,
          };
        },
        verifyUser: async () => 'wrong-owner',
      }),
      /Reconnect/
    );
    assert.equal(row.active, false);
    assert.equal(refreshes, scenario === 'marker' ? 0 : 1);
  }
});
test('expired canonical connection refuses even a fresh upstream token', async () => {
  const row = state();
  row.expiresAt = 1;
  let calls = 0;
  await assert.rejects(
    resolveSession(row, {
      markRefreshing: async () => {},
      save: async () => {},
      revoke: async () => {},
      refresh: async () => {
        calls++;
        return row.tokens;
      },
      verifyUser: async () => 'owner',
    }),
    /Reconnect/
  );
  assert.equal(calls, 0);
});

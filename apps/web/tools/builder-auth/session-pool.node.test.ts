import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createOpaqueVault } from './opaque-vault.ts';
import { createSessionVault } from './session-vault.ts';
import { createAuthStorage } from './storage.ts';
import { databaseFixture } from './test-fixtures.ts';

test('discards borrowed clients when a transaction or session lock times out', async () => {
  const error = Error('Query read timeout');
  const calls: Array<boolean | undefined> = [];
  const pool = {
    connect: async () => ({
      query: async () => {
        throw error;
      },
      release: (discard?: boolean) => calls.push(discard),
    }),
  } as unknown as Pool;
  const keys = new Map([['k1', randomBytes(32)]]);
  const storage = createAuthStorage(
    pool,
    createSessionVault({ activeKeyId: 'k1', keys }),
    createOpaqueVault('k1', keys)
  );
  const id = randomUUID();
  await assert.rejects(storage.revoke(id), error);
  await assert.rejects(
    storage.withSession(id, 1, async () => assert.fail('unexpected session')),
    error
  );
  assert.deepEqual(calls, [true, true]);
});

test('sessions save or revoke at capacity without borrowing another pool client', {
  timeout: 30000,
}, async () => {
  const f = await databaseFixture();
  const pool = new Pool({
    ...f.pool.options,
    options: '-c role=baci_builder_auth_storage',
    max: 4,
    connectionTimeoutMillis: 500,
  });
  const keys = new Map([['k1', randomBytes(32)]]);
  const storage = createAuthStorage(
    pool,
    createSessionVault({ activeKeyId: 'k1', keys }),
    createOpaqueVault('k1', keys)
  );
  const actorUserId = randomUUID();
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const initial = {
    accessToken: 'synthetic-initial-access',
    refreshToken: 'synthetic-initial-refresh',
    expiresAt: Date.now() + 60000,
  };
  const updated = {
    ...initial,
    accessToken: 'synthetic-refreshed-access',
    refreshToken: 'synthetic-refreshed-refresh',
  };
  try {
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1)', [actorUserId]);
    for (const connectionId of ids)
      await storage.createConnection(
        {
          connectionId,
          actorUserId,
          grantVersion: 1,
          providerGrantId: randomUUID(),
          scopes: ['storefront.read'],
          allowedMerchantIds: [],
          allowCreateStore: false,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        initial
      );
    const gate = Promise.withResolvers<void>();
    let waiting = 0;
    await Promise.all(
      ids.map((id, index) =>
        storage.withSession(id, 1, async (session) => {
          await session.markRefreshing();
          if (++waiting === ids.length) gate.resolve();
          await gate.promise;
          if (index < 2) await session.save(updated);
          else await session.revoke();
        })
      )
    );
    for (const id of ids.slice(0, 2))
      await storage.withSession(id, 1, async ({ row }) => {
        assert.deepEqual(row.tokens, updated);
        assert.equal(row.refreshStarted, false);
      });
    for (const id of ids.slice(2)) {
      assert.equal((await storage.readConnection(id))?.status, 'revoked');
      const remaining = await f.pool.query(
        'SELECT connection_id FROM builder_authorization.sessions WHERE connection_id=$1',
        [id]
      );
      assert.equal(remaining.rowCount, 0);
    }
  } finally {
    await pool.end();
    await f.close();
  }
});

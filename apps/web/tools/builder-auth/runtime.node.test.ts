import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createBuilderAuthRuntime } from './runtime.ts';
import { createLinkedSessionService } from './session-service.ts';
import { databaseFixture } from './test-fixtures.ts';

const actor = '10000000-0000-4000-8000-000000000001';
const connectionId = '20000000-0000-4000-8000-000000000001';
test('runtime refuses broad role and shared keys before contacting upstream', {
  timeout: 90000,
}, async () => {
  const db = await databaseFixture();
  try {
    const key = randomBytes(32);
    const settings = {
      pool: db.pool,
      provider: {
        issuer: 'https://auth.example.invalid',
        resource: 'https://mcp.example.invalid/builder/mcp',
        callback: 'https://chatgpt.com/new-callback',
        clientId: 'new-client',
        cookieKeys: [key.toString('base64url')],
        jwks: { keys: [] },
      },
      vault: { activeKeyId: 'fixture', keys: new Map([['fixture', key]]) },
      upstream: {
        issuer: 'https://upstream.example.invalid/auth/v1',
        clientId: 'dedicated-client',
        clientSecret: 'dedicated-secret',
        redirectUri: 'https://auth.example.invalid/upstream/callback',
      },
      supabase: {
        url: 'https://upstream.example.invalid',
        anonKey: 'public-key',
      },
      connectionTtlSeconds: 3600,
      authenticateDisconnect: async () => actor,
    };
    await assert.rejects(
      createBuilderAuthRuntime(settings),
      /Unsafe builder auth database role/
    );
    await assert.rejects(
      createBuilderAuthRuntime({ ...settings, pool: db.providerPool }),
      /keys must be separate/
    );
  } finally {
    await db.close();
  }
});
test('backend resolver denies an access token when disconnect wins during getUser', {
  timeout: 90000,
}, async () => {
  const db = await databaseFixture();
  try {
    await db.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await db.storage.createConnection(
      {
        connectionId,
        actorUserId: actor,
        providerGrantId: 'grant-race',
        grantVersion: 1,
        scopes: ['storefront.read'],
        allowedMerchantIds: [],
        allowCreateStore: false,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
      {
        accessToken: 'private-upstream',
        refreshToken: 'private-refresh',
        expiresAt: Date.now() + 300000,
      }
    );
    const resolve = createLinkedSessionService({
      storage: db.storage,
      refresh: async () => {
        throw new Error('Must not refresh a fresh token');
      },
      verifyUser: async () => {
        await db.storage.revoke(connectionId);
        return actor;
      },
    });
    await assert.rejects(
      resolve({ connectionId, actorUserId: actor, grantVersion: 1 }),
      /Reconnect/
    );
  } finally {
    await db.close();
  }
});
test('a persistent interrupted-refresh marker requires reconnect after restart without reusing credentials', {
  timeout: 90000,
}, async () => {
  const db = await databaseFixture();
  try {
    await db.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await db.storage.createConnection(
      {
        connectionId,
        actorUserId: actor,
        providerGrantId: 'grant-interrupted',
        grantVersion: 1,
        scopes: ['storefront.read'],
        allowedMerchantIds: [],
        allowCreateStore: false,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
      { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 1 }
    );
    await assert.rejects(
      db.storage.withSession(connectionId, 1, async (ctx) => {
        await ctx.markRefreshing();
        throw new Error('Simulated process loss');
      }),
      /Simulated/
    );
    let attempts = 0;
    const restarted = createLinkedSessionService({
      storage: db.storage,
      refresh: async () => {
        attempts++;
        throw new Error('Must not reuse indeterminate refresh');
      },
      verifyUser: async () => actor,
    });
    await assert.rejects(
      restarted({ connectionId, actorUserId: actor, grantVersion: 1 }),
      /Reconnect/
    );
    assert.equal(attempts, 0);
    assert.equal(
      (await db.storage.readConnection(connectionId))?.status,
      'revoked'
    );
  } finally {
    await db.close();
  }
});

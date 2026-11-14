import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLinkedBuildDiscovery } from './build-discovery.ts';

test('discovers one user-authorized build without exposing tokens in the result', async () => {
  const [connectionId, actorUserId, merchantId, jobId] = Array.from(
    { length: 4 },
    () => randomUUID()
  );
  const calls: unknown[] = [];
  const discovery = createLinkedBuildDiscovery({
    listConnections: async () => [connectionId],
    readConnection: async () => ({
      connectionId,
      actorUserId,
      grantVersion: 1,
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
      scopes: ['storefront.write'],
      allowedMerchantIds: [merchantId],
    }),
    resolveLinkedAccessToken: async () => 'synthetic-secret',
    resolveUser: async () => ({
      actorUserId,
      client: {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: [jobId], error: null };
        },
      },
    }),
    execute: async (input) => {
      calls.push(input);
    },
  });
  const result = await discovery.runOnce();
  assert.deepEqual(result, {
    cursor: connectionId,
    connections: 1,
    executed: 1,
    failed: 0,
  });
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  assert.deepEqual(calls[0], {
    name: 'experience_list_due_builds',
    args: { p_merchant: merchantId, p_connection: connectionId, p_version: 1 },
  });
  assert.deepEqual(calls[1], {
    connectionId,
    actorUserId,
    grantVersion: 1,
    merchantId,
    jobId,
  });
});

test('skips expired or invalid grants and refuses a mismatched user', async () => {
  const [connectionId, actorUserId, merchantId] = Array.from(
    { length: 3 },
    () => randomUUID()
  );
  let expiresAt = 'invalid';
  let executions = 0;
  const discovery = createLinkedBuildDiscovery({
    listConnections: async () => [connectionId],
    readConnection: async () => ({
      connectionId,
      actorUserId,
      grantVersion: 1,
      status: 'active',
      expiresAt,
      revokedAt: null,
      scopes: ['storefront.write'],
      allowedMerchantIds: [merchantId],
    }),
    resolveLinkedAccessToken: async () => 'synthetic-secret',
    resolveUser: async () => ({
      actorUserId: randomUUID(),
      client: {
        rpc: async () => {
          throw Error('must not query');
        },
      },
    }),
    execute: async () => {
      executions++;
    },
  });
  assert.equal((await discovery.runOnce()).failed, 0);
  expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await discovery.runOnce()).failed, 0);
  expiresAt = new Date(Date.now() + 60_000).toISOString();
  assert.equal((await discovery.runOnce()).failed, 1);
  assert.equal(executions, 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLinkedEditRunner } from './edit-runner.ts';

const id = '10000000-0000-4000-8000-000000000001';
test('bounded runner uses normal linked clients and fixed bodyless endpoint; no commerce SQL credential', async () => {
  const calls: string[] = [];
  const runner = createLinkedEditRunner({
    listConnections: async () => [id],
    readConnection: async () => ({
      connectionId: id,
      actorUserId: id,
      grantVersion: 1,
      status: 'active',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      allowedMerchantIds: [id],
      scopes: ['storefront.read', 'storefront.write'],
      allowCreateStore: false,
      revokedAt: null,
    }),
    resolveLinkedAccessToken: async () => 'private-fixture-token',
    resolveUser: async () => ({
      actorUserId: id,
      client: {
        rpc: async (name: string, args: unknown) => {
          calls.push(name);
          assert.equal(JSON.stringify(args).includes('instructions'), false);
          return { data: [id], error: null };
        },
      },
    }),
    fetchImpl: async (url, options) => {
      calls.push(String(url));
      assert.equal(options?.body, undefined);
      assert.equal(options?.redirect, 'error');
      return new Response('{}', { status: 200 });
    },
  });
  assert.deepEqual(await runner.runOnce(), {
    cursor: id,
    connections: 1,
    executed: 1,
    failed: 0,
  });
  assert.deepEqual(calls, [
    'builder_list_due_edits',
    `https://usebaci.com/api/integrations/chatgpt/builder-operations/${id}/run`,
  ]);
});
test('revoked/expired connections never resolve tokens or run work', async () => {
  const runner = createLinkedEditRunner({
    listConnections: async () => [id],
    readConnection: async () => null,
    resolveLinkedAccessToken: async () => {
      throw Error('must not run');
    },
    resolveUser: async () => {
      throw Error('must not run');
    },
  });
  assert.equal((await runner.runOnce()).executed, 0);
});

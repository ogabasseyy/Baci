import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLinkedBuildDiscovery } from './build-discovery.ts';
import { getLinkedUser } from './user-client.ts';

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

test('advances across backlogged merchants and wraps after reaching the end', async () => {
  const ids = Array.from({ length: 23 }, () => randomUUID()).sort();
  const actorUserId = randomUUID();
  const merchantId = randomUUID();
  const jobId = randomUUID();
  const executed: string[] = [];
  const discovery = createLinkedBuildDiscovery({
    listConnections: async (after, limit) =>
      ids.filter((id) => after === null || id > after).slice(0, limit),
    readConnection: async (connectionId) => ({
      connectionId,
      actorUserId,
      grantVersion: 1,
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
      scopes: ['storefront.write'],
      allowedMerchantIds: [merchantId],
    }),
    resolveLinkedAccessToken: async () => 'synthetic-token',
    resolveUser: async () => ({
      actorUserId,
      client: { rpc: async () => ({ data: [jobId], error: null }) },
    }),
    execute: async ({ connectionId }) => {
      executed.push(connectionId);
    },
  });
  let cursor: string | null = null;
  for (let tick = 0; tick < ids.length + 2; tick++) {
    const result = await discovery.runOnce(cursor);
    cursor = result.cursor;
  }
  assert.deepEqual(executed, [...ids, ids[0]]);
});

for (const reason of ['shutdown', 'deadline'] as const) {
  test(`cancels a stalled Data API read on ${reason} and admits no job`, async (t) => {
    const [connectionId, actorUserId, merchantId, jobId] = Array.from(
      { length: 4 },
      () => randomUUID()
    );
    const admission = new AbortController();
    const deadline = new AbortController();
    const entered = Promise.withResolvers<AbortSignal | null | undefined>();
    const budget = t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
    const execute = t.mock.fn(async () => {});
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
      resolveLinkedAccessToken: async () => 'synthetic-token',
      resolveUser: (token, signal) =>
        getLinkedUser(
          {
            url: 'https://synthetic.example',
            anonKey: 'synthetic-publishable-key',
            fetchImpl: async (input, init) => {
              if (String(input).includes('/auth/v1/user'))
                return Response.json({ id: actorUserId });
              entered.resolve(init?.signal);
              return new Promise((resolve, reject) => {
                const fallback = setTimeout(
                  () => resolve(Response.json([jobId])),
                  150
                );
                init?.signal?.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(fallback);
                    reject(init.signal?.reason);
                  },
                  { once: true }
                );
              });
            },
          },
          token,
          signal
        ),
      execute,
    });
    const running = discovery.runOnce(null, admission.signal);
    const signal = await entered.promise;
    assert.equal(budget.mock.calls[0]?.arguments[0], 10_000);
    if (reason === 'shutdown') {
      admission.abort();
      await assert.rejects(running, { name: 'AbortError' });
    } else {
      deadline.abort(new DOMException('Synthetic deadline', 'TimeoutError'));
      assert.equal((await running).failed, 1);
    }
    assert.equal(signal?.aborted, true);
    assert.equal(execute.mock.callCount(), 0);
  });
}

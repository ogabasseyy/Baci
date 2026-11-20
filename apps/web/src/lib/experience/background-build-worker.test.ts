// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createBackgroundBuildWorker } from './background-build-worker';

it('wires scoped discovery to user-authorized finalization and stops cleanly', async () => {
  const [connectionId, actorUserId, merchantId, jobId] = Array.from(
    { length: 4 },
    () => randomUUID()
  );
  const row = {
    connectionId,
    actorUserId,
    grantVersion: 1,
    status: 'active',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    scopes: ['storefront.read', 'storefront.write'],
    allowedMerchantIds: [merchantId],
    allowCreateStore: false,
  };
  const finalizer = vi.fn(
    async (
      _ctx: unknown,
      _input: { jobId: string; idempotencyKey: string }
    ) => ({ buildId: randomUUID(), buildDigest: 'a'.repeat(64) })
  );
  const admitted = Promise.withResolvers<void>();
  finalizer.mockImplementationOnce(async () => {
    admitted.resolve();
    return { buildId: randomUUID(), buildDigest: 'a'.repeat(64) };
  });
  let scheduled = () => {};
  const cancel = vi.fn();
  const worker = createBackgroundBuildWorker({
    listConnections: async () => [connectionId],
    readConnection: async () => row,
    resolveLinkedAccessToken: async () => 'synthetic-secret',
    resolveUser: async () => ({
      actorUserId,
      client: { rpc: async () => ({ data: [jobId], error: null }) },
    }),
    resolveUserClient: async () =>
      ({ rpc: async () => ({ data: 'ready', error: null }) }) as never,
    finalizeBuild: finalizer,
    schedule: (tick) => {
      scheduled = tick;
      return cancel;
    },
  });
  scheduled();
  await admitted.promise;
  await worker.close();
  expect(finalizer).toHaveBeenCalledOnce();
  expect(finalizer.mock.calls[0][1]).toEqual({ jobId, idempotencyKey: jobId });
  expect(cancel).toHaveBeenCalledOnce();
  scheduled();
  expect(finalizer).toHaveBeenCalledOnce();
});

it('drains a discovery tick without starting a job found after shutdown', async () => {
  const [connectionId, actorUserId, merchantId, jobId] = Array.from(
    { length: 4 },
    () => randomUUID()
  );
  const entered = Promise.withResolvers<void>();
  const due = Promise.withResolvers<{ data: string[]; error: null }>();
  const resolveUserClient = vi.fn();
  let scheduled = () => {};
  const worker = createBackgroundBuildWorker({
    listConnections: async () => [connectionId],
    readConnection: async () => ({
      connectionId,
      actorUserId,
      grantVersion: 1,
      status: 'active',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      scopes: ['storefront.write'],
      allowedMerchantIds: [merchantId],
      allowCreateStore: false,
    }),
    resolveLinkedAccessToken: async () => 'synthetic',
    resolveUser: async () => ({
      actorUserId,
      client: {
        rpc: () => {
          entered.resolve();
          return due.promise;
        },
      },
    }),
    resolveUserClient,
    finalizeBuild: vi.fn(),
    schedule: (tick) => {
      scheduled = tick;
      return () => {};
    },
  });
  scheduled();
  await entered.promise;
  const closing = worker.close();
  due.resolve({ data: [jobId], error: null });
  await closing;
  expect(resolveUserClient).not.toHaveBeenCalled();
});

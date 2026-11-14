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
  await worker.close();
  expect(finalizer).toHaveBeenCalledOnce();
  expect(finalizer.mock.calls[0][1]).toEqual({ jobId, idempotencyKey: jobId });
  expect(cancel).toHaveBeenCalledOnce();
  scheduled();
  expect(finalizer).toHaveBeenCalledOnce();
});

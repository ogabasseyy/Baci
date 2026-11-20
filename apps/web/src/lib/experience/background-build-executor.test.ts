// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createLinkedBuildDiscovery } from '../../../tools/builder-auth/build-discovery';
import { createBackgroundBuildExecutor } from './background-build-executor';

it('rechecks the canonical connection and executes with the linked user client', async () => {
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
  const client = {
    synthetic: true,
    rpc: vi.fn(async () => ({ data: 'ready', error: null })),
  };
  const resolveUserClient = vi.fn(
    async (_identity: BuilderIdentity) => client as never
  );
  const finalizeBuild = vi.fn(async () => ({
    buildId: randomUUID(),
    buildDigest: 'a'.repeat(64),
  }));
  const execute = createBackgroundBuildExecutor({
    readConnection: async () => row,
    resolveUserClient,
    finalizeBuild,
  });
  await execute({
    connectionId,
    actorUserId,
    grantVersion: 1,
    merchantId,
    jobId,
  });
  const identity = resolveUserClient.mock.calls[0][0];
  expect(identity).toMatchObject({
    connectionId,
    actorUserId,
    grantVersion: 1,
    allowedMerchantIds: [merchantId],
  });
  expect(identity.scopes.has('storefront.write')).toBe(true);
  expect(client.rpc).toHaveBeenCalledWith(
    'experience_prepare_background_build',
    {
      p_merchant: merchantId,
      p_connection: connectionId,
      p_version: 1,
      p_job: jobId,
    }
  );
  expect(finalizeBuild).toHaveBeenCalledWith(
    { identity, merchantId, supabase: client },
    { jobId, idempotencyKey: jobId }
  );
  row.revokedAt = new Date().toISOString() as never;
  await expect(
    execute({ connectionId, actorUserId, grantVersion: 1, merchantId, jobId })
  ).rejects.toThrow();
  expect(finalizeBuild).toHaveBeenCalledTimes(1);
});

it('passes a discovered job into the executor without forwarding its session token', async () => {
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
  const finalizeBuild = vi.fn(async () => ({
    buildId: randomUUID(),
    buildDigest: 'a'.repeat(64),
  }));
  const execute = createBackgroundBuildExecutor({
    readConnection: async () => row,
    resolveUserClient: async () =>
      ({
        synthetic: true,
        rpc: async () => ({ data: 'ready', error: null }),
      }) as never,
    finalizeBuild,
  });
  const discovery = createLinkedBuildDiscovery({
    listConnections: async () => [connectionId],
    readConnection: async () => row,
    resolveLinkedAccessToken: async () => 'synthetic-secret',
    resolveUser: async () => ({
      actorUserId,
      client: { rpc: async () => ({ data: [jobId], error: null }) },
    }),
    execute: async (binding) => {
      expect(JSON.stringify(binding)).not.toContain('synthetic-secret');
      await execute(binding);
    },
  });
  expect((await discovery.runOnce()).executed).toBe(1);
  expect(finalizeBuild).toHaveBeenCalledOnce();
});

it('does not start finalization when recovery reports the job unavailable', async () => {
  const [connectionId, actorUserId, merchantId, jobId] = Array.from(
    { length: 4 },
    () => randomUUID()
  );
  const finalizeBuild = vi.fn();
  const execute = createBackgroundBuildExecutor({
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
    resolveUserClient: async () =>
      ({ rpc: async () => ({ data: 'unavailable', error: null }) }) as never,
    finalizeBuild,
  });
  await expect(
    execute({ connectionId, actorUserId, grantVersion: 1, merchantId, jobId })
  ).rejects.toThrow('BUILD_UNAVAILABLE');
  expect(finalizeBuild).not.toHaveBeenCalled();
});

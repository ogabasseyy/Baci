import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { applyStorefrontOperation } from '@/lib/website-builder/apply-edit';
import { claimStorefrontEdit } from '@/lib/website-builder/claim-edit';
import { createEditExecutionHandler } from '@/lib/website-builder/edit-execution';
import { authenticateEditUser } from '@/lib/website-builder/edit-user';
import { queueStorefrontEdit } from '@/lib/website-builder/queue-edit';
import { getStorefrontOperation } from '@/lib/website-builder/read-operation';
import { getStorefrontStatus } from '@/lib/website-builder/read-storefront';
import { runStorefrontEdit } from '@/lib/website-builder/run-edit';
export async function verifyAuthenticatedAsyncEdit(
  ctx: BuilderContext,
  url: string,
  token: string
) {
  const status = await getStorefrontStatus(ctx);
  const queued = await queueStorefrontEdit(ctx, {
    storefrontId: ctx.merchantId,
    pageSlug: 'home',
    expectedVersion: status.draftVersion,
    idempotencyKey: randomUUID(),
    instructions: 'Set the hero heading to Summer collection',
  });
  expect(queued.status).toBe('pending');
  if (queued.status !== 'pending') throw Error('Expected queue');
  expect((await getStorefrontOperation(ctx, queued.operationId)).status).toBe(
    'pending'
  );
  expect((await getStorefrontStatus(ctx)).pendingOperationIds).toContain(
    queued.operationId
  );
  const handler = createEditExecutionHandler({
    authenticate: (t) =>
      authenticateEditUser(t, { url, anonKey: 'fixture-public-key' }),
    execute: async (next, id) => {
      const lease = await claimStorefrontEdit(next, id);
      expect(lease).not.toBeNull();
      if (!lease) throw Error('Expected lease');
      return runStorefrontEdit(next, lease, {
        rateLimit: () => ({ allowed: true }),
        generate: async () => ({
          status: 'proposed',
          summary: 'Updated',
          operations: [
            {
              kind: 'update_component',
              componentId: 'hero',
              patch: { componentType: 'Hero', title: 'Summer collection' },
            },
          ],
        }),
      });
    },
  });
  const endpoint = `https://usebaci.com/api/integrations/chatgpt/builder-operations/${queued.operationId}/run`;
  expect(
    (
      await handler(
        new Request(endpoint, {
          method: 'POST',
          headers: { authorization: 'Bearer invalid' },
        }),
        queued.operationId
      )
    ).status
  ).toBe(401);
  const response = await handler(
    new Request(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }),
    queued.operationId
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'accepted' });
  expect((await getStorefrontOperation(ctx, queued.operationId)).status).toBe(
    'ready'
  );
  expect((await getStorefrontStatus(ctx)).draftVersion).toBe(
    status.draftVersion
  );
  const input = {
    storefrontId: ctx.merchantId,
    operationId: queued.operationId,
    expectedVersion: status.draftVersion,
    idempotencyKey: randomUUID(),
  };
  const applied = await applyStorefrontOperation(ctx, input);
  expect(applied.status).toBe('draft');
  expect(await applyStorefrontOperation(ctx, input)).toEqual(applied);
  expect((await getStorefrontOperation(ctx, queued.operationId)).status).toBe(
    'applied'
  );
  expect((await getStorefrontStatus(ctx)).isPublished).toBe(false);
  for (const path of ['builder_edit_operations', 'edit_quota']) {
    const raw = await fetch(`${url}/rest/v1/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(raw.status).toBe(404);
  }
}

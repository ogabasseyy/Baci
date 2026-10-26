import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type {
  BuilderContext,
  BuilderIdentity,
} from '@/lib/builder-connector/types';
import { createBuilderGateway } from '@/lib/builder-gateway/gateway';
import { createBuilderServiceDispatcher } from '@/lib/builder-gateway/services';
import { claimStorefrontEdit } from '@/lib/website-builder/claim-edit';
import { runStorefrontEdit } from '@/lib/website-builder/run-edit';

type Linked = Parameters<typeof createBuilderServiceDispatcher>[0];
/** Real normal-user PostgREST business services behind the authenticated gateway. */
export async function verifyAuthenticatedGateway(
  ctx: BuilderContext,
  authenticate: (r: Request) => Promise<BuilderIdentity>,
  request: () => Request,
  linked: Linked
) {
  const audit: unknown[] = [];
  const handler = createBuilderGateway({
    authenticate,
    execute: createBuilderServiceDispatcher(linked),
    audit: (event) => {
      audit.push(event);
    },
  });
  const call = async (tool: string, input: unknown) =>
    handler(
      new Request(
        `https://usebaci.com/api/integrations/chatgpt/builder/${tool}`,
        {
          method: 'POST',
          headers: {
            ...Object.fromEntries(request().headers),
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        }
      ),
      tool
    );
  const list = await (await call('list_storefronts', {})).json();
  expect(list.stores[0].storefrontId).toBe(ctx.merchantId);
  const status = await (
    await call('get_storefront_status', { storefrontId: ctx.merchantId })
  ).json();
  expect(status.capabilities.supported).toBe(true);
  const existing = await (
    await call('create_storefront_draft', {
      businessName: 'Journey Store',
      businessType: 'electronics',
      country: 'NG',
      requestedSlug: 'journey-store',
      idempotencyKey: randomUUID(),
    })
  ).json();
  expect(existing.code).toBe('STORE_ALREADY_EXISTS');
  const other = await (
    await call('get_storefront_status', { storefrontId: randomUUID() })
  ).json();
  expect(other.code).toBe('NOT_FOUND');
  const queued = await (
    await call('update_storefront_draft', {
      storefrontId: ctx.merchantId,
      pageSlug: 'home',
      expectedVersion: status.draftVersion,
      instructions: 'Change hero to Autumn collection',
      idempotencyKey: randomUUID(),
    })
  ).json();
  expect(queued.status).toBe('pending');
  expect(
    (
      await (
        await call('get_storefront_operation', {
          storefrontId: ctx.merchantId,
          operationId: queued.operationId,
        })
      ).json()
    ).status
  ).toBe('pending');
  const lease = await claimStorefrontEdit(ctx, queued.operationId);
  if (!lease) throw Error('Expected lease');
  await runStorefrontEdit(ctx, lease, {
    rateLimit: () => ({ allowed: true }),
    generate: async () => ({
      status: 'proposed',
      summary: 'Updated',
      operations: [
        {
          kind: 'update_component',
          componentId: 'hero',
          patch: { componentType: 'Hero', title: 'Autumn collection' },
        },
      ],
    }),
  });
  const input = {
    storefrontId: ctx.merchantId,
    operationId: queued.operationId,
    expectedVersion: status.draftVersion,
    idempotencyKey: randomUUID(),
  };
  const applied = await (
    await call('apply_storefront_operation', input)
  ).json();
  expect(applied.status).toBe('draft');
  expect(
    await (await call('apply_storefront_operation', input)).json()
  ).toEqual(applied);
  expect(JSON.stringify(audit)).not.toContain('Autumn collection');
  expect(JSON.stringify(audit)).not.toContain(
    request().headers.get('authorization')
  );
  expect(
    (
      await (
        await call('get_storefront_status', { storefrontId: ctx.merchantId })
      ).json()
    ).isPublished
  ).toBe(false);
  return {
    async verifyRevoked() {
      expect((await call('list_storefronts', {})).status).toBe(401);
    },
  };
}

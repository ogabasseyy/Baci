import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { applyStorefrontOperation } from './apply-edit';
import { queueStorefrontEdit } from './queue-edit';
import { getStorefrontOperation } from './read-operation';

const id = '10000000-0000-4000-8000-000000000001';
function setup(data: unknown) {
  const rpc = vi.fn().mockImplementation(async (name: string) => ({
    data: name === 'builder_prepare_apply' ? null : data,
    error: null,
  }));
  const ctx: BuilderContext = {
    identity: {
      actorUserId: id,
      connectionId: id,
      grantVersion: 1,
      scopes: new Set(['storefront.read', 'storefront.write']),
      allowedMerchantIds: [id],
      allowCreateStore: false,
    },
    merchantId: id,
    supabase: { rpc } as unknown as SupabaseClient<never>,
  };
  return { rpc, ctx };
}
describe('private asynchronous edit services', () => {
  it('queues semantic instructions once through the canonical transaction', async () => {
    const result = {
      storefrontId: id,
      operationId: id,
      sourceVersion: `draft:${id}`,
      status: 'pending',
    };
    const { ctx, rpc } = setup(result);
    expect(
      await queueStorefrontEdit(ctx, {
        storefrontId: id,
        expectedVersion: `draft:${id}`,
        idempotencyKey: id,
        pageSlug: 'home',
        instructions: 'Change heading',
      })
    ).toEqual(result);
    expect(rpc).toHaveBeenCalledWith(
      'builder_queue_edit',
      expect.objectContaining({
        p_connection: id,
        p_version: 1,
        p_expected: id,
        p_instructions: 'Change heading',
      })
    );
  });
  it('polling only reads; provider errors and raw candidates are not public DTOs', async () => {
    const result = {
      storefrontId: id,
      operationId: id,
      sourceVersion: `draft:${id}`,
      status: 'ready',
      summary: 'Draft candidate ready for review.',
    };
    const { ctx, rpc } = setup(result);
    expect(await getStorefrontOperation(ctx, id)).toEqual(result);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('builder_get_operation');
  });
  it('apply passes only operation binding and CAS, never a caller supplied candidate', async () => {
    const { ctx, rpc } = setup({
      storefrontId: id,
      version: `draft:${id}`,
      changedPages: ['home'],
      status: 'draft',
    });
    await applyStorefrontOperation(ctx, {
      storefrontId: id,
      expectedVersion: `draft:${id}`,
      idempotencyKey: id,
      operationId: id,
    });
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('builder_apply_operation');
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_config');
  });
  it('rejects missing write scope and unsupported page before any database/provider work', async () => {
    const { ctx, rpc } = setup(null);
    ctx.identity.scopes = new Set(['storefront.read']);
    await expect(
      queueStorefrontEdit(ctx, {
        storefrontId: id,
        expectedVersion: `draft:${id}`,
        idempotencyKey: id,
        pageSlug: 'home',
        instructions: 'Edit',
      })
    ).rejects.toThrow('Authorize');
    expect(rpc).not.toHaveBeenCalled();
  });
});

it('rejects a non-home page at the semantic boundary', async () => {
  const { ctx, rpc } = setup(null);
  await expect(
    queueStorefrontEdit(ctx, {
      storefrontId: id,
      expectedVersion: `draft:${id}`,
      idempotencyKey: id,
      pageSlug: 'other' as 'home',
      instructions: 'Edit',
    })
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it('revalidates the stored candidate before requesting atomic application', async () => {
  const { ctx, rpc } = setup({
    storefrontId: id,
    version: `draft:${id}`,
    changedPages: ['home'],
    status: 'draft',
  });
  rpc.mockImplementation(async (name: string) =>
    name === 'builder_prepare_apply'
      ? {
          data: {
            sourceConfig: {},
            candidate: { content: 'unsafe' },
            candidateDigest: 'a'.repeat(64),
          },
          error: null,
        }
      : {
          data: {
            storefrontId: id,
            version: `draft:${id}`,
            changedPages: ['home'],
            status: 'draft',
          },
          error: null,
        }
  );
  await expect(
    applyStorefrontOperation(ctx, {
      storefrontId: id,
      expectedVersion: `draft:${id}`,
      idempotencyKey: id,
      operationId: id,
    })
  ).rejects.toThrow();
  expect(rpc.mock.calls.some((c) => c[0] === 'builder_apply_operation')).toBe(
    false
  );
});

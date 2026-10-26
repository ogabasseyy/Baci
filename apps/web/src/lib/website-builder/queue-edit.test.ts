import { expect, it } from 'vitest';
import { id, setup } from './edit-service.test-support';
import { queueStorefrontEdit } from './queue-edit';

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

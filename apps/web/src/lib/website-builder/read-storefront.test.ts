import { expect, it } from 'vitest';
import { id, setup } from './edit-service.test-support';
import { getStorefrontStatus, readBuilderStorefronts } from './read-storefront';

it('scopes empty inventory reads to the authorized connection and merchant', async () => {
  const { ctx, rpc } = setup([]);
  await expect(
    readBuilderStorefronts(ctx.supabase, ctx.identity, id)
  ).resolves.toEqual([]);
  expect(rpc).toHaveBeenCalledWith('builder_read_storefronts', {
    p_connection: id,
    p_version: 1,
    p_merchant: id,
  });
  await expect(getStorefrontStatus(ctx)).rejects.toThrow(
    expect.objectContaining({ code: 'NOT_FOUND' })
  );
});
it('denies missing read scope before accessing inventory', async () => {
  const { ctx, rpc } = setup([]);
  ctx.identity = { ...ctx.identity, scopes: new Set() };
  await expect(
    readBuilderStorefronts(ctx.supabase, ctx.identity)
  ).rejects.toThrow(expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }));
  expect(rpc).not.toHaveBeenCalled();
});

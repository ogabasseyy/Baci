import { expect, it } from 'vitest';
import { z } from 'zod';
import { checkStore, editBinding, editResult, editRpc } from './edit-rpc';
import { id, setup } from './edit-service.test-support';

it('binds connection version and merchant and denies another storefront', () => {
  const { ctx } = setup(null);
  expect(editBinding(ctx)).toEqual({
    p_connection: id,
    p_version: 1,
    p_merchant: id,
  });
  expect(() => checkStore(ctx, 'other')).toThrow(
    expect.objectContaining({ code: 'NOT_FOUND' })
  );
});
it('redacts database failures at the edit boundary', async () => {
  const { ctx, rpc } = setup(null);
  rpc.mockResolvedValue({ data: null, error: { message: 'private SQL' } });
  await expect(editRpc(ctx, 'builder_apply_edit', {})).rejects.toThrow(
    expect.objectContaining({ code: 'OPERATION_FAILED' })
  );
});
it('rejects malformed success payloads', () => {
  expect(() =>
    editResult(z.object({ ok: z.literal(true) }).strict(), {
      ok: true,
      secret: 'hidden',
    })
  ).toThrow();
});

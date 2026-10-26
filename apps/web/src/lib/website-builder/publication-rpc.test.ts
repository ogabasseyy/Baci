import { expect, it } from 'vitest';
import { id, setup } from './edit-service.test-support';
import {
  publicationResult,
  publicationRpc,
  readStoredPublication,
} from './publication-rpc';

it('redacts database errors before publication results escape', async () => {
  const { ctx, rpc } = setup(null);
  rpc.mockResolvedValue({ data: null, error: { message: 'private SQL' } });
  await expect(
    publicationRpc(ctx.supabase, 'builder_load_publication_intent')
  ).rejects.toThrow(expect.objectContaining({ code: 'OPERATION_FAILED' }));
});
it('validates stored approval records before use', async () => {
  const { ctx, rpc } = setup({ secret: 'hidden' });
  await expect(readStoredPublication(ctx.supabase, id)).rejects.toThrow();
  expect(rpc).toHaveBeenCalledWith('builder_load_publication_intent', {
    p_intent: id,
  });
  expect(() =>
    publicationResult({ status: 'published', secret: 'hidden' })
  ).toThrow();
});

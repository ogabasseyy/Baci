import { expect, it } from 'vitest';
import { id, setup } from './edit-service.test-support';
import { loadPublishConfirmation } from './load-publication';

it('returns a committed receipt without rereading the draft or creating another approval', async () => {
  const receipt = {
    storefrontId: id,
    version: `draft:${id}`,
    receiptId: id,
    publishedVersion: `published:${id}`,
    status: 'verifying',
  };
  const { ctx, rpc } = setup({ receipt });
  await expect(loadPublishConfirmation(ctx.supabase, id)).resolves.toEqual({
    kind: 'receipt',
    receipt,
  });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('builder_load_publication_intent', {
    p_intent: id,
  });
});

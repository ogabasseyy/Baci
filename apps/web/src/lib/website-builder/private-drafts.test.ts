import { expect, it } from 'vitest';
import { createPrivateHome } from './create-private-home';
import { id, setup } from './edit-service.test-support';
import { commitDraft } from './private-drafts';

it('denies writes before touching the database', async () => {
  const { ctx, rpc } = setup(null);
  ctx.identity = { ...ctx.identity, scopes: new Set() };
  await expect(
    commitDraft(ctx, {
      expectedVersion: 'draft:invalid',
      idempotencyKey: id,
      config: createPrivateHome('Test'),
    })
  ).rejects.toThrow(expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }));
  expect(rpc).not.toHaveBeenCalled();
});

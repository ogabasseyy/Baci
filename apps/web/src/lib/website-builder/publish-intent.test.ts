import { expect, it } from 'vitest';
import { id, setup } from './edit-service.test-support';
import { requestStorefrontPublication } from './publish-intent';

it('requires publication scope before creating approval selectors', async () => {
  const { ctx, rpc } = setup(null);
  await expect(
    requestStorefrontPublication(ctx, {
      storefrontId: id,
      expectedVersion: 'draft:invalid',
      idempotencyKey: id,
    })
  ).rejects.toThrow(expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }));
  expect(rpc).not.toHaveBeenCalled();
});

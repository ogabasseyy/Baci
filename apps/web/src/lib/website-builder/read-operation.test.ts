import { expect, it } from 'vitest';
import { id, setup } from './edit-service.test-support';
import { getStorefrontOperation } from './read-operation';

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

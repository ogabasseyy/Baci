import { expect, it } from 'vitest';
import { applyStorefrontOperation } from './apply-edit';
import { id, setup } from './edit-service.test-support';

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

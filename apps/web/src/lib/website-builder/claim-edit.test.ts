import { expect, it } from 'vitest';
import { claimStorefrontEdit } from './claim-edit';
import { id, setup } from './edit-service.test-support';

it('returns no lease when no operation is due and binds the caller', async () => {
  const { ctx, rpc } = setup(null);
  await expect(claimStorefrontEdit(ctx, id)).resolves.toBeNull();
  expect(rpc).toHaveBeenCalledWith(
    'builder_claim_edit',
    expect.objectContaining({
      p_connection: id,
      p_merchant: id,
      p_operation: id,
      p_version: 1,
    })
  );
});
it('rejects malformed operation identifiers before database access', async () => {
  const { ctx, rpc } = setup(null);
  await expect(claimStorefrontEdit(ctx, 'invalid')).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it('rejects malformed leases rather than exposing unvalidated data', async () => {
  const { ctx } = setup({ secret: 'private' });
  await expect(claimStorefrontEdit(ctx, id)).rejects.toThrow();
});

import { expect, it, vi } from 'vitest';
import { requestExperienceRollback } from './rollback-service';

vi.mock('./publication-performance', () => ({
  requirePublicationPerformance: vi.fn().mockResolvedValue(undefined),
}));

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  storefrontId: id,
  buildId: id,
  expectedDraftVersion: 2,
  expectedPublishedVersion: 1,
  idempotencyKey: id,
};
function fixture(allow: boolean, rpcError: boolean) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'experience_authorize_publish')
      return { data: allow, error: null };
    if (name === 'experience_request_lifecycle')
      return {
        data: { status: 'confirmation-required' },
        error: rpcError ? { code: 'REJECTED' } : null,
      };
    throw Error('UNEXPECTED_RPC');
  });
  const ctx = {
    merchantId: id,
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
      rpc,
    },
  };
  return { rpc, ctx: ctx as never };
}
it('creates only a rollback intent with the bound versions and retry key', async () => {
  const { ctx, rpc } = fixture(true, false);
  await expect(requestExperienceRollback(ctx, input)).resolves.toEqual({
    status: 'confirmation-required',
  });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    'experience_authorize_publish',
    'experience_request_lifecycle',
  ]);
  expect(rpc).toHaveBeenLastCalledWith(
    'experience_request_lifecycle',
    expect.objectContaining({
      p_merchant: id,
      p_action: 'rollback',
      p_retry: id,
      p_payload: {
        buildId: id,
        expectedDraftVersion: 2,
        expectedPublishedVersion: 1,
      },
    })
  );
});
it('stops before creating the intent when owner authority is denied', async () => {
  const { ctx, rpc } = fixture(false, false);
  await expect(requestExperienceRollback(ctx, input)).rejects.toThrow(
    'NOT_FOUND'
  );
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('fails closed when the lifecycle RPC rejects the request', async () => {
  const { ctx } = fixture(true, true);
  await expect(requestExperienceRollback(ctx, input)).rejects.toThrow(
    'UNAVAILABLE'
  );
});

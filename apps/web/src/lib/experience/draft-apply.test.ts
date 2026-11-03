import { expect, it, vi } from 'vitest';
import { requestDraftApply } from './draft-apply';

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  buildId: id,
  evidenceId: id,
  expectedVersion: 0,
  idempotencyKey: id,
};
function fixture() {
  const rpc = vi.fn(async (name: string) =>
    name === 'experience_require_owner'
      ? { data: true, error: null }
      : {
          data: {
            approvalId: id,
            effectDigest: 'a'.repeat(64),
            expiresAt: '2026-10-24T20:00:00Z',
            status: 'confirmation-required',
          },
          error: null,
        }
  );
  return {
    rpc,
    ctx: {
      merchantId: id,
      supabase: {
        auth: {
          getUser: async () => ({ data: { user: { id } }, error: null }),
        },
        rpc,
      },
    } as never,
  };
}
it('requests an owner-bound intent only, never a pointer confirmation', async () => {
  const f = fixture();
  await expect(requestDraftApply(f.ctx, input)).resolves.toMatchObject({
    status: 'confirmation-required',
  });
  expect(f.rpc).toHaveBeenLastCalledWith(
    'experience_request_draft_apply',
    expect.objectContaining({
      p_merchant: id,
      p_build: id,
      p_evidence: id,
      p_expected: 0,
      p_retry: id,
    })
  );
  expect(f.rpc.mock.calls.some(([name]) => name.includes('confirm'))).toBe(
    false
  );
});
it('rejects approval booleans and malformed input before authorization or business reads', async () => {
  const f = fixture();
  await expect(
    requestDraftApply(f.ctx, { ...input, approved: true })
  ).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
});
it('does not fabricate approval when storage fails or returns malformed authority', async () => {
  const f = fixture();
  f.rpc.mockResolvedValue({ data: true, error: null });
  await expect(requestDraftApply(f.ctx, input)).rejects.toThrow();
});

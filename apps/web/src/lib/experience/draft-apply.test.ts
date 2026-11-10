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
  const rows: Record<string, unknown> = {};
  const filters = vi.fn();
  const from = vi.fn((table: string) => {
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => {
        filters(table, key, value);
        return q;
      },
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    };
    return q;
  });
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
    rows,
    filters,
    ctx: {
      merchantId: id,
      supabase: {
        from,
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

it('maps the preview tool capture ID to its merchant/build/attempt-bound attestation', async () => {
  const f = fixture();
  const attestationId = '44444444-4444-4444-8444-444444444444';
  f.rows.experience_snapshots = { build_id: id, build_digest: 'a'.repeat(64) };
  f.rows.experience_builds = {
    job_id: 'job',
    build_digest: 'a'.repeat(64),
    host_origin: 'http://localhost:4100',
  };
  f.rows.experience_jobs = { attempt_nonce: 'attempt', status: 'finalized' };
  f.rows.experience_evidence = { id: attestationId };
  await expect(requestDraftApply(f.ctx, input)).resolves.toMatchObject({
    status: 'confirmation-required',
  });
  expect(f.rpc).toHaveBeenLastCalledWith(
    'experience_request_draft_apply',
    expect.objectContaining({
      p_evidence: attestationId,
      p_build: id,
      p_merchant: id,
    })
  );
  for (const table of Object.keys(f.rows))
    expect(f.filters).toHaveBeenCalledWith(table, 'merchant_id', id);
  expect(f.filters).toHaveBeenCalledWith(
    'experience_evidence',
    'attempt_nonce',
    'attempt'
  );
  expect(f.filters).toHaveBeenCalledWith(
    'experience_evidence',
    'build_digest',
    'a'.repeat(64)
  );
});
it.each([
  'wrong-build',
  'wrong-digest',
  'missing-job',
  'missing-attestation',
])('rejects unbound captured evidence: %s', async (failure) => {
  const f = fixture();
  f.rows.experience_snapshots = {
    build_id: failure === 'wrong-build' ? 'other' : id,
    build_digest: 'a'.repeat(64),
  };
  f.rows.experience_builds = {
    job_id: 'job',
    build_digest: (failure === 'wrong-digest' ? 'b' : 'a').repeat(64),
    host_origin: 'http://localhost:4100',
  };
  if (failure !== 'missing-job')
    f.rows.experience_jobs = { attempt_nonce: 'attempt', status: 'finalized' };
  await expect(requestDraftApply(f.ctx, input)).rejects.toThrow(
    'APPROVAL_UNAVAILABLE'
  );
  expect(
    f.rpc.mock.calls.some(([name]) => name === 'experience_request_draft_apply')
  ).toBe(false);
});

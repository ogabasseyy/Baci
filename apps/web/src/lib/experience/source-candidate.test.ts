import { expect, it, vi } from 'vitest';

vi.mock('./authorization', () => ({
  requireExperienceOwner: vi.fn(async (ctx: unknown) => ctx),
  ownerRpcArgs: () => ({ p_merchant: id, p_connection: id, p_version: 1 }),
}));

import { adoptSourceCandidate } from './source-candidate';

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  artifactId: id,
  baseDigest: 'a'.repeat(64),
  expectedVersion: 1,
  idempotencyKey: id,
};
function fixture(found = true) {
  const rpc = vi.fn(async () => ({
    data: { artifactId: id, version: 2, conflict: false },
    error: null,
  }));
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: found ? { source_digest: 'b'.repeat(64) } : null,
      error: null,
    })),
  };
  return {
    rpc,
    chain,
    ctx: { merchantId: id, supabase: { from: vi.fn(() => chain), rpc } },
  };
}
it('advances only a normal owner-readable completed artifact using its stored digest and exact base/version', async () => {
  const f = fixture();
  await expect(
    adoptSourceCandidate(f.ctx as never, input)
  ).resolves.toMatchObject({ version: 2, conflict: false });
  expect(f.chain.eq).toHaveBeenCalledWith('merchant_id', id);
  expect(f.rpc).toHaveBeenCalledWith(
    'experience_apply_source',
    expect.objectContaining({
      p_artifact: id,
      p_payload: 'b'.repeat(64),
      p_base: 'a'.repeat(64),
      p_expected: 1,
    })
  );
});
it('rejects absent/other-tenant artifacts and caller confirmation flags without mutating source', async () => {
  const f = fixture(false);
  await expect(adoptSourceCandidate(f.ctx as never, input)).rejects.toThrow(
    'NOT_FOUND'
  );
  expect(f.rpc).not.toHaveBeenCalled();
  await expect(
    adoptSourceCandidate(f.ctx as never, { ...input, confirmed: true })
  ).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
});

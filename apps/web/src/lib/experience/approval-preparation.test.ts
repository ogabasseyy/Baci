// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createApprovalPreparation } from './approval-preparation';
import { VerifierTemporarilyUnavailable } from './verifier-availability';

const expiredId = '11111111-1111-4111-8111-111111111111';
const freshId = '22222222-2222-4222-8222-222222222222';
function setup() {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const data = {
    approvalId: freshId,
    status: 'confirmation-required',
    effectDigest: 'a'.repeat(64),
    expiresAt,
  };
  const query = Promise.resolve({ data, error: null });
  const rpc = vi.fn(() => Object.assign(query, { abortSignal: () => query }));
  const client = { rpc } as unknown as Parameters<
    ReturnType<typeof createApprovalPreparation>
  >[0];
  const attest = vi.fn(async () => {});
  return {
    expiresAt,
    client,
    attest,
    rpc,
    prepare: createApprovalPreparation(attest, 'draft'),
  };
}

it('returns the renewed intent only after its independent proof is ready', async () => {
  const f = setup();
  f.attest.mockRejectedValueOnce(new VerifierTemporarilyUnavailable());
  await expect(f.prepare(f.client, expiredId)).resolves.toEqual({
    approvalId: freshId,
    status: 'preparing',
  });
  await expect(f.prepare(f.client, freshId)).resolves.toEqual({
    approvalId: freshId,
    status: 'ready',
    expiresAt: f.expiresAt,
  });
  expect(f.attest).toHaveBeenCalledWith(
    f.client,
    freshId,
    'draft',
    expect.any(AbortSignal)
  );
  expect(
    f.rpc.mock.calls.every(
      ([name]: unknown[]) => name === 'experience_prepare_approval'
    )
  ).toBe(true);
});

it('does not return a ready result after the owner disconnects', async () => {
  const f = setup();
  const abort = new AbortController();
  const error = Error('owner disconnected');
  f.attest.mockImplementationOnce(async () => abort.abort(error));
  await expect(f.prepare(f.client, expiredId, abort.signal)).rejects.toBe(
    error
  );
});

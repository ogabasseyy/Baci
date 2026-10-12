import { expect, it, vi } from 'vitest';
import { createReplaySignatureReader } from './replay-signature-reader';
import type { StoreRpc } from './replay-store';

const scope = {
  receiptId: '10000000-0000-4000-8000-000000000001',
  payloadSha256: 'b'.repeat(64),
  claimToken: '20000000-0000-4000-8000-000000000001',
};
const stored = {
  receiptId: scope.receiptId,
  payloadSha256: scope.payloadSha256,
  signature: 'Ab'.repeat(64),
};

function fixture(value: unknown = stored) {
  const callMock = vi.fn(
    async (_fn: string, _params: Record<string, unknown>): Promise<unknown> =>
      value
  );
  const call: StoreRpc['call'] & typeof callMock = Object.assign(
    async <Result>(
      fn: string,
      params: Record<string, unknown>
    ): Promise<Result> => (await callMock(fn, params)) as Result,
    callMock
  );
  return { call, read: createReplaySignatureReader({ call }) };
}

it('reads the exact active receipt/digest/token tuple once and preserves original hex casing', async () => {
  const sample = fixture();
  expect(await sample.read(scope)).toEqual(stored);
  expect(sample.call).toHaveBeenCalledExactlyOnceWith(
    'read_piggyvest_staging_receipt_signature',
    {
      p_receipt_id: scope.receiptId,
      p_payload_sha256: scope.payloadSha256,
      p_claim_token: scope.claimToken,
    }
  );
});

it('preserves a null RPC result without fallback or fabricated signature', async () => {
  const sample = fixture(null);
  expect(await sample.read(scope)).toBeNull();
  expect(sample.call).toHaveBeenCalledOnce();
});

it.each([
  { receiptId: 'not-a-uuid' },
  { claimToken: null },
  { payloadSha256: 'b'.repeat(63) },
  { extra: 'not-allowed' },
])('validates the requested lease before storage: %j', async (change) => {
  const sample = fixture();
  await expect(sample.read({ ...scope, ...change })).rejects.toThrow(
    'Invalid receipt signature lookup'
  );
  expect(sample.call).not.toHaveBeenCalled();
});

it.each([
  { receiptId: '10000000-0000-4000-8000-000000000002' },
  { payloadSha256: 'c'.repeat(64) },
])('rejects a signature belonging to another receipt identity: %j', async (change) => {
  const sample = fixture({ ...stored, ...change });
  await expect(sample.read(scope)).rejects.toThrow(
    'Receipt signature identity mismatch'
  );
  expect(sample.call).toHaveBeenCalledOnce();
});

it.each([
  { value: undefined },
  { value: true },
  { value: [stored] },
  { value: { ...stored, signature: '' } },
  { value: { ...stored, signature: `${stored.signature}\n` } },
  { value: { ...stored, signature: 'Ｇ'.repeat(128) } },
  { value: { ...stored, secret: 'synthetic' } },
])('rejects malformed storage response without exposing it: %j', async ({
  value,
}) => {
  const sample = fixture();
  sample.call.mockResolvedValue(value);
  await expect(sample.read(scope)).rejects.toThrow(
    /^Invalid receipt signature response$/
  );
});

it('sanitizes a storage exception without a cause or fallback', async () => {
  const sample = fixture();
  sample.call.mockRejectedValue(new Error('synthetic-sensitive-body'));
  const result = sample.read(scope);
  await expect(result).rejects.toThrow(
    /^Receipt signature lookup unavailable$/
  );
  await expect(result).rejects.not.toHaveProperty('cause');
  expect(sample.call).toHaveBeenCalledOnce();
});

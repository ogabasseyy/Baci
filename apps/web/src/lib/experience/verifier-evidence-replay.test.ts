import { expect, it, vi } from 'vitest';
import { hasExactVerifierEvidence } from './verifier-evidence-replay';

const receipt = {
  merchantId: 'merchant',
  jobId: 'job',
  attemptNonce: 'attempt',
  buildDigest: 'build',
  receiptDigest: 'receipt',
  hostOrigin: 'https://shop.example.com',
};
const stored: Record<string, string> = {
  merchant_id: receipt.merchantId,
  job_id: receipt.jobId,
  attempt_nonce: receipt.attemptNonce,
  build_digest: receipt.buildDigest,
  receipt_digest: receipt.receiptDigest,
  host_origin: receipt.hostOrigin,
};
function fixture(error: unknown = null) {
  const filters = new Map<string, string>();
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: string) => {
      filters.set(column, value);
      return query;
    }),
    abortSignal: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: Object.entries(stored).every(
        ([key, value]) => filters.get(key) === value
      )
        ? { id: 'evidence' }
        : null,
      error,
    })),
  };
  return {
    query,
    client: { from: vi.fn(() => query) },
  };
}

it('replays only the exact receipt under all six binding filters', async () => {
  const { client, query } = fixture();
  const { signal } = new AbortController();
  await expect(
    hasExactVerifierEvidence(client as never, receipt, signal)
  ).resolves.toBe(true);
  expect(client.from).toHaveBeenCalledWith('experience_evidence');
  expect(query.select).toHaveBeenCalledWith('id');
  expect(query.eq.mock.calls).toEqual(Object.entries(stored));
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  for (const key of Object.keys(receipt)) {
    const f = fixture();
    await expect(
      hasExactVerifierEvidence(f.client as never, {
        ...receipt,
        [key]: 'different',
      })
    ).resolves.toBe(false);
  }
});

it('does not treat database failure or cancellation as successful replay', async () => {
  const failed = fixture({ code: '57014' });
  await expect(
    hasExactVerifierEvidence(failed.client as never, receipt)
  ).resolves.toBe(false);
  const f = fixture();
  await expect(
    hasExactVerifierEvidence(f.client as never, receipt, AbortSignal.abort())
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.client.from).not.toHaveBeenCalled();
  const caller = new AbortController();
  const pending = hasExactVerifierEvidence(
    f.client as never,
    receipt,
    caller.signal
  );
  caller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

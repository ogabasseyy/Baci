import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAccrualReplay } from './replay-accrual-runtime';

const secret = 'synthetic-interest-signing-secret';
const raw = Buffer.from(
  `{"eventId":"accrual-event-1","customer_id":"01M3N0TE6QWPFNPRGVCQG11N1P","eventType":"interest-accrued.success","eventCategory":"interest_accrued","eventData":{"id":"accrual-1","wallet_id":"b7ff9afd-bb88-11f1-a539-42010a9c0026","balance":1650000,"percentage":9,"interest_date":"2026-09-28T00:00:00.000Z","amount":406.8493150684931234,"interest_type":"original"},"pvb_wallet":"01M3N0TE015JJR1YKBFC2JWZJ9","pvb_wallet_name":"Synthetic customer","pvb_split_interest_with_wallet":null,"pvb_split_interest_with_wallet_name":null}`
);
const digest = createHash('sha256').update(raw).digest('hex');
const lease = {
  receiptId: '60000000-0000-4000-8000-000000000001',
  eventId: 'accrual-event-1',
  claimToken: '70000000-0000-4000-8000-000000000001',
  sealed: {
    payloadSha256: digest,
    ciphertext: '',
    nonce: '',
    authTag: '',
    keyVersion: 'staging-v1' as const,
  },
};
const scope = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  businessId: 'synthetic-business',
  expectedSystemId: '7685292944002592802',
};
const proof = {
  receiptId: lease.receiptId,
  payloadSha256: digest,
  signature: createHmac('sha512', secret).update(raw).digest('hex'),
};

function setup(outcome = 'applied') {
  const execute = vi.fn(async () => ({ rows: [{ result: outcome }] }));
  const readOriginalSignature = vi.fn(async () => proof);
  return {
    execute,
    readOriginalSignature,
    replay: createAccrualReplay(scope, secret, execute),
  };
}

describe('signed fractional-kobo interest observations', () => {
  it('passes the original decimal token without rounding or rewriting the signed payload', async () => {
    const input = setup();
    await expect(
      input.replay({
        lease,
        raw,
        readOriginalSignature: input.readOriginalSignature,
      })
    ).resolves.toBe('applied');
    expect(input.execute).toHaveBeenCalledWith(
      'SELECT piggyvest_staging.record_interest_accrual($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::json) AS result',
      [
        scope.integrationId,
        scope.businessId,
        scope.expectedSystemId,
        lease.receiptId,
        digest,
        raw.toString('utf8'),
      ]
    );
    expect(input.readOriginalSignature).toHaveBeenCalledWith({
      receiptId: lease.receiptId,
      payloadSha256: digest,
      claimToken: lease.claimToken,
    });
  });

  it('returns duplicate only when the observation database confirms it', async () => {
    const input = setup('duplicate');
    await expect(
      input.replay({
        lease,
        raw,
        readOriginalSignature: input.readOriginalSignature,
      })
    ).resolves.toBe('duplicate');
  });

  it('does not record historical receipts without original signature provenance', async () => {
    const input = setup();
    await expect(
      input.replay({ lease, raw, readOriginalSignature: async () => null })
    ).rejects.toThrow('Interest accrual replay deferred');
    expect(input.execute).not.toHaveBeenCalled();
  });

  it.each([
    { ...proof, receiptId: '60000000-0000-4000-8000-000000000002' },
    { ...proof, payloadSha256: 'f'.repeat(64) },
    { ...proof, signature: 'f'.repeat(128) },
    { ...proof, signature: 'invalid' },
  ])('rejects mismatched provenance or invalid provider signatures before recording', async (signature) => {
    const input = setup();
    await expect(
      input.replay({ lease, raw, readOriginalSignature: async () => signature })
    ).rejects.toThrow();
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('rejects changed raw bytes even when the event identifier is unchanged', async () => {
    const input = setup();
    await expect(
      input.replay({
        lease,
        raw: Buffer.from(
          raw.toString('utf8').replace('406.8493150684931234', '500')
        ),
        readOriginalSignature: input.readOriginalSignature,
      })
    ).rejects.toThrow();
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('rejects a changed transport event identifier before recording', async () => {
    const input = setup();
    await expect(
      input.replay({
        lease: { ...lease, eventId: 'other-event' },
        raw,
        readOriginalSignature: input.readOriginalSignature,
      })
    ).rejects.toThrow();
    expect(input.execute).not.toHaveBeenCalled();
  });

  it.each([
    'deferred',
    'unexpected',
  ])('does not acknowledge a missing or malformed database result (%s)', async (outcome) => {
    const input = setup(outcome);
    await expect(
      input.replay({
        lease,
        raw,
        readOriginalSignature: input.readOriginalSignature,
      })
    ).rejects.toThrow('Interest accrual replay deferred');
  });

  it.each([
    'conflict',
    'invalid',
  ])('quarantines incompatible observation economics (%s)', async (outcome) => {
    const input = setup(outcome);
    await expect(
      input.replay({
        lease,
        raw,
        readOriginalSignature: input.readOriginalSignature,
      })
    ).rejects.toMatchObject({ name: 'DispatchQuarantine' });
  });

  it('redacts database and signature-reader failures', async () => {
    const input = setup();
    input.execute.mockRejectedValueOnce(new Error('password=secret'));
    await expect(
      input.replay({
        lease,
        raw,
        readOriginalSignature: input.readOriginalSignature,
      })
    ).rejects.toThrow('Interest accrual replay deferred');
    input.execute.mockClear();
    await expect(
      input.replay({
        lease,
        raw,
        readOriginalSignature: async () => {
          throw new Error('token=secret');
        },
      })
    ).rejects.toThrow('Interest accrual replay deferred');
    expect(input.execute).not.toHaveBeenCalled();
  });
});

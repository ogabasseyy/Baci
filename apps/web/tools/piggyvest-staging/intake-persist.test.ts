import { describe, expect, it, vi } from 'vitest';
import { createIntakePersistence } from './intake-persist';

const sealed = {
  payloadSha256: 'a'.repeat(64),
  ciphertext: 'eA==',
  nonce: 'a'.repeat(16),
  authTag: Buffer.alloc(16).toString('base64'),
  keyVersion: 'staging-v1' as const,
  originalSignature: 'Ab'.repeat(64),
};
const receipt = {
  receiptId: 'f18a0000-0000-4000-8000-000000000001',
  duplicate: false,
  durable: true,
  signatureStored: true,
};

describe('restricted receipt persistence', () => {
  it('uses only the internal RPC and returns a validated receipt', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(receipt));
    await expect(
      createIntakePersistence('synthetic', fetcher)(sealed)
    ).resolves.toEqual(receipt);
    expect(fetcher).toHaveBeenCalledWith(
      'http://pvb-staging-receipts-rest:3000/rpc/accept_signed_piggyvest_staging_receipt',
      expect.objectContaining({
        redirect: 'error',
        method: 'POST',
        body: JSON.stringify({
          p_payload_sha256: sealed.payloadSha256,
          p_ciphertext: sealed.ciphertext,
          p_nonce: sealed.nonce,
          p_auth_tag: sealed.authTag,
          p_key_version: sealed.keyVersion,
          p_original_signature: sealed.originalSignature,
        }),
      })
    );
  });
  it('refuses invalid input before making a database request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createIntakePersistence(
        'synthetic',
        fetcher
      )({ ...sealed, payloadSha256: 'bad' })
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not expose database failure bodies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('sensitive synthetic detail', { status: 500 })
      );
    await expect(
      createIntakePersistence('synthetic', fetcher)(sealed)
    ).rejects.toThrow('Durable staging receipt unavailable');
  });
  it('does not treat a non-durable or malformed success as acceptance', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...receipt, durable: false }));
    await expect(
      createIntakePersistence('synthetic', fetcher)(sealed)
    ).rejects.toThrow();
  });

  it('rejects an unsigned legacy acknowledgement rather than falling back', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        receiptId: receipt.receiptId,
        duplicate: false,
        durable: true,
      })
    );
    await expect(
      createIntakePersistence('synthetic', fetcher)(sealed)
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

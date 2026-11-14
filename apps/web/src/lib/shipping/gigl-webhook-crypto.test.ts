import { describe, expect, it, vi } from 'vitest';
import { decryptGiglWebhookPayload } from './gigl-webhook-crypto';
import {
  encryptLikeGig,
  GIG_DOC_SAMPLE_BODY,
  GIG_DOC_SAMPLE_SECRET,
} from './gigl-webhook-crypto.test-support';

vi.mock('server-only', () => ({}));

const SECRET = 'test-registration-secret';

function flipByte(base64: string, index: number): string {
  const bytes = Buffer.from(base64, 'base64');
  bytes[index] ^= 0x01;
  return bytes.toString('base64');
}

describe('decryptGiglWebhookPayload', () => {
  it("decrypts GIG's published sample with its sample secret", async () => {
    const plaintext = await decryptGiglWebhookPayload(
      GIG_DOC_SAMPLE_BODY,
      GIG_DOC_SAMPLE_SECRET
    );

    expect(JSON.parse(plaintext ?? 'null')).toMatchObject({
      Waybill: '1349104478',
      StatusCode: 'MCRT',
    });
  });

  it('round-trips a payload encrypted the way GIG encrypts it', async () => {
    const encrypted = encryptLikeGig('{"Waybill":"1349639673"}', SECRET);

    await expect(decryptGiglWebhookPayload(encrypted, SECRET)).resolves.toBe(
      '{"Waybill":"1349639673"}'
    );
  });

  it('returns null for the wrong secret', async () => {
    const encrypted = encryptLikeGig('{"Waybill":"1349639673"}', SECRET);

    await expect(
      decryptGiglWebhookPayload(encrypted, 'another-secret')
    ).resolves.toBeNull();
  });

  it('returns null when the final ciphertext block is tampered with', async () => {
    const encrypted = encryptLikeGig('{"Waybill":"1349639673"}', SECRET);
    const tampered = flipByte(
      encrypted,
      Buffer.from(encrypted, 'base64').length - 1
    );

    await expect(decryptGiglWebhookPayload(tampered, SECRET)).resolves.toBe(
      null
    );
  });

  it('never returns the original plaintext once the IV is tampered with', async () => {
    const plaintext = '{"Waybill":"1349639673"}';
    const tampered = flipByte(encryptLikeGig(plaintext, SECRET), 16);

    await expect(decryptGiglWebhookPayload(tampered, SECRET)).resolves.not.toBe(
      plaintext
    );
  });

  it('returns null for framing that cannot hold a ciphertext block', async () => {
    const headerOnly = Buffer.alloc(32, 1).toString('base64');
    const misaligned = Buffer.alloc(32 + 17, 1).toString('base64');

    await expect(decryptGiglWebhookPayload(headerOnly, SECRET)).resolves.toBe(
      null
    );
    await expect(decryptGiglWebhookPayload(misaligned, SECRET)).resolves.toBe(
      null
    );
  });

  it('returns null without a secret', async () => {
    const encrypted = encryptLikeGig('{}', SECRET);

    await expect(decryptGiglWebhookPayload(encrypted, '')).resolves.toBeNull();
  });
});

import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptValidatedPrefundedCardLegacyReceipt } from './prefunded-card-legacy-receipt-decrypt';

const key = Buffer.alloc(32, 7);
const raw = Buffer.from('{"synthetic":"original receipt"}');
const nonce = Buffer.alloc(12, 3);
const digest = createHash('sha256').update(raw).digest('hex');
const cipher = createCipheriv('aes-256-gcm', key, nonce);
cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${digest}`));
const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
const fullAuthTag = cipher.getAuthTag();
const sealed = {
  payloadSha256: digest,
  ciphertext: ciphertext.toString('base64'),
  nonce: nonce.toString('base64'),
  authTag: fullAuthTag.toString('base64'),
  keyVersion: 'staging-v1' as const,
};

describe('validated receipt decryption at the decipher boundary', () => {
  it('decrypts a sealed receipt without schema parsing', () => {
    expect(
      decryptValidatedPrefundedCardLegacyReceipt(sealed, key.toString('base64'))
    ).toEqual(raw);
  });
  it('refuses truncated auth tags without schema parsing', () => {
    // Valid 12-byte prefix of the real tag: Node accepts it without an
    // explicit tag length, so this fails if authTagLength: 16 is removed.
    const truncated = {
      ...sealed,
      authTag: fullAuthTag.subarray(0, 12).toString('base64'),
    };
    expect(() =>
      decryptValidatedPrefundedCardLegacyReceipt(
        truncated,
        key.toString('base64')
      )
    ).toThrow(/^Legacy receipt refused$/);
  });
});

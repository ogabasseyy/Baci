import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptPrefundedCardLegacyReceipt } from './prefunded-card-legacy-receipt';
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
  keyVersion: 'staging-v1',
};

describe('stored original receipt decryption for owner reconciliation', () => {
  it('authenticates the existing staging-v1 AAD, GCM tag and digest without manufacturing a signature', () => {
    expect(
      decryptPrefundedCardLegacyReceipt(sealed, key.toString('base64'))
    ).toEqual(raw);
  });
  it.each([
    { payloadSha256: '0'.repeat(64) },
    { authTag: Buffer.alloc(16).toString('base64') },
    // Rejected at parse time (schema pins 16-byte tags); the decipher-layer
    // refusal is covered directly below without schema parsing.
    { authTag: Buffer.alloc(12).toString('base64') },
    { nonce: Buffer.alloc(12).toString('base64') },
    { keyVersion: 'staging-v2' },
    { ciphertext: 'not-base64' },
    { ciphertext: Buffer.alloc(65537).toString('base64') },
  ])('refuses tampered or excessive receipts: %j', (change) => {
    expect(() =>
      decryptPrefundedCardLegacyReceipt(
        { ...sealed, ...change },
        key.toString('base64')
      )
    ).toThrow('Legacy receipt refused');
  });
  it('refuses truncated auth tags at the decipher boundary without schema parsing', () => {
    // Valid 12-byte prefix of the real tag: Node accepts it without an
    // explicit tag length, so this fails if authTagLength: 16 is removed.
    const truncated: Parameters<
      typeof decryptValidatedPrefundedCardLegacyReceipt
    >[0] = {
      ...sealed,
      keyVersion: 'staging-v1',
      authTag: fullAuthTag.subarray(0, 12).toString('base64'),
    };
    expect(() =>
      decryptValidatedPrefundedCardLegacyReceipt(
        truncated,
        key.toString('base64')
      )
    ).toThrow();
  });
  it('refuses invalid or different keys with redacted errors', () => {
    for (const other of ['invalid', Buffer.alloc(32, 8).toString('base64')]) {
      expect(() => decryptPrefundedCardLegacyReceipt(sealed, other)).toThrow(
        /^Legacy receipt refused$/
      );
    }
  });
});

import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptPrefundedCardLegacyReceipt } from './prefunded-card-legacy-receipt';

const key = Buffer.alloc(32, 7);
const raw = Buffer.from('{"synthetic":"original receipt"}');
const nonce = Buffer.alloc(12, 3);
const digest = createHash('sha256').update(raw).digest('hex');
const cipher = createCipheriv('aes-256-gcm', key, nonce);
cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${digest}`));
const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
const sealed = {
  payloadSha256: digest,
  ciphertext: ciphertext.toString('base64'),
  nonce: nonce.toString('base64'),
  authTag: cipher.getAuthTag().toString('base64'),
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
    // Defense-in-depth note: the schema already pins 16-byte tags, so this
    // row is rejected at parse time; the explicit authTagLength: 16 in the
    // decipher is a redundant backstop with no observable difference while
    // the schema holds, and cannot be isolated behaviorally without
    // weakening validation (which we will not do to test hardening).
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
  it('refuses invalid or different keys with redacted errors', () => {
    for (const other of ['invalid', Buffer.alloc(32, 8).toString('base64')]) {
      expect(() => decryptPrefundedCardLegacyReceipt(sealed, other)).toThrow(
        /^Legacy receipt refused$/
      );
    }
  });
});

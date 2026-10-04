import { describe, expect, it } from 'vitest';
import { signedIntakeSchemas } from './intake-signed';

const sealed = {
  payloadSha256: 'a'.repeat(64),
  ciphertext: 'eA==',
  nonce: Buffer.alloc(12).toString('base64'),
  authTag: Buffer.alloc(16).toString('base64'),
  keyVersion: 'staging-v1',
  originalSignature: 'aB'.repeat(64),
};

describe('signed intake provenance', () => {
  it('preserves the original header without rewriting its case', () => {
    expect(signedIntakeSchemas.sealed.parse(sealed)).toEqual(sealed);
  });

  it.each([
    undefined,
    null,
    '',
    'a'.repeat(127),
    'g'.repeat(128),
    `${'a'.repeat(128)}\n`,
  ])('refuses missing or malformed signature provenance', (originalSignature) => {
    expect(
      signedIntakeSchemas.sealed.safeParse({ ...sealed, originalSignature })
        .success
    ).toBe(false);
  });

  it('refuses noncanonical encryption fields and additional input', () => {
    expect(
      signedIntakeSchemas.sealed.safeParse({ ...sealed, nonce: 'bad' }).success
    ).toBe(false);
    expect(
      signedIntakeSchemas.sealed.safeParse({
        ...sealed,
        signatureVerified: true,
      }).success
    ).toBe(false);
  });

  it('requires explicit durable signature storage acknowledgement', () => {
    const receipt = {
      receiptId: 'f18a0000-0000-4000-8000-000000000001',
      duplicate: false,
      durable: true,
    };
    expect(signedIntakeSchemas.receipt.safeParse(receipt).success).toBe(false);
    expect(
      signedIntakeSchemas.receipt.safeParse({
        ...receipt,
        signatureStored: false,
      }).success
    ).toBe(false);
    expect(
      signedIntakeSchemas.receipt.parse({ ...receipt, signatureStored: true })
    ).toMatchObject({ signatureStored: true });
  });
});

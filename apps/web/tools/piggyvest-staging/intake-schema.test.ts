import { describe, expect, it } from 'vitest';
import { intakeSchema } from './intake-schema';

const valid = {
  payloadSha256: 'ab'.repeat(32),
  ciphertext: Buffer.from([0xff, 0x00]).toString('base64'),
  nonce: Buffer.alloc(12, 1).toString('base64'),
  authTag: Buffer.alloc(16, 2).toString('base64'),
  keyVersion: 'staging-v1',
};

describe('sealed staging intake schema', () => {
  it('accepts sealed opaque bytes without interpreting the payload', () => {
    expect(intakeSchema.parse(valid)).toEqual(valid);
  });

  it.each([0, 1024 * 1024])('accepts ciphertext boundary %s', (length) => {
    expect(
      intakeSchema.safeParse({
        ...valid,
        ciphertext: Buffer.alloc(length).toString('base64'),
      }).success
    ).toBe(true);
  });

  it.each([
    { payloadSha256: 'ab'.repeat(31) },
    { payloadSha256: 'zz'.repeat(32) },
    { payloadSha256: 'AB'.repeat(32) },
    { payloadSha256: `${'ab'.repeat(32)}\n` },
    { ciphertext: 'not base64!' },
    { ciphertext: '/w' },
    { ciphertext: '/x==' },
    { ciphertext: Buffer.alloc(1024 * 1024 + 1).toString('base64') },
    { nonce: Buffer.alloc(11).toString('base64') },
    { nonce: '!'.repeat(16) },
    { authTag: Buffer.alloc(17).toString('base64') },
    { authTag: '!'.repeat(24) },
    { keyVersion: 'production-v1' },
    { plaintext: 'must never reach storage' },
  ])('rejects malformed sealed metadata', (override) => {
    expect(intakeSchema.safeParse({ ...valid, ...override }).success).toBe(
      false
    );
  });

  it.each(Object.keys(valid))('requires %s', (field) => {
    const incomplete = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== field)
    );
    expect(intakeSchema.safeParse(incomplete).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  giglTrackingTokenCacheRecordSchema,
  giglTrackingTokenSchema,
} from './gigl-tracking-token-cache';

describe('GIGL tracking cache record schema', () => {
  const value = {
    version: 1,
    salt: 'a'.repeat(32),
    iv: 'b'.repeat(24),
    tag: 'c'.repeat(32),
    ciphertext: 'YWJj',
  };

  it('accepts the bounded encrypted record', () => {
    expect(giglTrackingTokenCacheRecordSchema.safeParse(value).success).toBe(
      true
    );
  });

  it.each([
    { ...value, salt: 'short' },
    { ...value, iv: 'x'.repeat(24) },
    { ...value, tag: 'short' },
    { ...value, ciphertext: '!' },
    { ...value, ciphertext: 'a'.repeat(100001) },
    { ...value, version: 2 },
    { ...value, unexpected: 'value' },
  ])('rejects invalid or extra fields', (record) => {
    expect(giglTrackingTokenCacheRecordSchema.safeParse(record).success).toBe(
      false
    );
  });

  it('validates decrypted token values independently', () => {
    const token = {
      token: 'synthetic-token',
      userChannelCode: 'channel',
      customerType: 1.5,
      expiresAt: 1_900_000_000_000,
    };
    expect(giglTrackingTokenSchema.safeParse(token).success).toBe(true);
    expect(
      giglTrackingTokenSchema.safeParse({ ...token, token: '' }).success
    ).toBe(false);
    expect(
      giglTrackingTokenSchema.safeParse({
        ...token,
        customerType: Number.POSITIVE_INFINITY,
      }).success
    ).toBe(false);
  });
});

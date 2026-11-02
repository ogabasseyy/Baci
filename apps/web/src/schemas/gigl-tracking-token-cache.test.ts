import { describe, expect, it } from 'vitest';
import { giglTrackingTokenCacheRecordSchema } from './gigl-tracking-token-cache';

describe('GIGL tracking cache record schema', () => {
  const value = {
    fingerprint: 'a'.repeat(64),
    token: {
      token: 'synthetic-token',
      userChannelCode: 'channel',
      customerType: 1.5,
      expiresAt: 1_900_000_000_000,
    },
  };

  it('accepts the bounded provider token record', () => {
    expect(giglTrackingTokenCacheRecordSchema.safeParse(value).success).toBe(
      true
    );
  });

  it.each([
    { ...value, fingerprint: 'short' },
    { ...value, token: { ...value.token, token: '' } },
    {
      ...value,
      token: { ...value.token, customerType: Number.POSITIVE_INFINITY },
    },
    { ...value, unexpected: 'value' },
  ])('rejects invalid or extra fields', (record) => {
    expect(giglTrackingTokenCacheRecordSchema.safeParse(record).success).toBe(
      false
    );
  });
});

import { describe, expect, it } from 'vitest';
import { oxygenLoginResponseSchema } from './oxygen-login';

// Synthetic fixtures only; no real provider material.
const VALID_TOKEN = 'syn-oxygen-login-token-001';

describe('oxygenLoginResponseSchema', () => {
  it('accepts a minimal valid login response', () => {
    expect(
      oxygenLoginResponseSchema.safeParse({
        token: VALID_TOKEN,
        expires_in: 300,
      })
    ).toEqual({
      success: true,
      data: { token: VALID_TOKEN, expires_in: 300 },
    });
  });

  it('accepts the expires_in boundaries 1 and 86400', () => {
    for (const expires_in of [1, 86_400]) {
      const parsed = oxygenLoginResponseSchema.safeParse({
        token: VALID_TOKEN,
        expires_in,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('strips extra fields so nothing amount-ish can surface as money', () => {
    const parsed = oxygenLoginResponseSchema.safeParse({
      token: VALID_TOKEN,
      expires_in: 300,
      eligible_amount: 50_000,
      amount: 12_500,
      successful: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ token: VALID_TOKEN, expires_in: 300 });
  });

  it.each([
    ['missing token', { expires_in: 300 }],
    ['empty token', { token: '', expires_in: 300 }],
    ['non-string token', { token: 123, expires_in: 300 }],
    ['missing expires_in', { token: VALID_TOKEN }],
    ['zero expires_in', { token: VALID_TOKEN, expires_in: 0 }],
    ['negative expires_in', { token: VALID_TOKEN, expires_in: -5 }],
    ['fractional expires_in', { token: VALID_TOKEN, expires_in: 1.5 }],
    ['huge expires_in', { token: VALID_TOKEN, expires_in: 86_401 }],
    ['string expires_in', { token: VALID_TOKEN, expires_in: '300' }],
    ['NaN expires_in', { token: VALID_TOKEN, expires_in: Number.NaN }],
    [
      'Infinity expires_in',
      { token: VALID_TOKEN, expires_in: Number.POSITIVE_INFINITY },
    ],
    [
      'negative Infinity expires_in',
      { token: VALID_TOKEN, expires_in: Number.NEGATIVE_INFINITY },
    ],
    ['null body', null],
    ['array body', []],
    ['string body', 'ok'],
  ])('rejects %s', (_label, body) => {
    expect(oxygenLoginResponseSchema.safeParse(body).success).toBe(false);
  });
});

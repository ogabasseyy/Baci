import { describe, expect, it } from 'vitest';
import {
  JumiaSelfAuthorizationTokenResponseSchema,
  JumiaTokenResponseSchema,
} from './auth';

describe('Jumia token response contracts', () => {
  it('keeps refresh fields optional for web OAuth responses', () => {
    const result = JumiaTokenResponseSchema.safeParse({
      access_token: 'access-token',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    expect(result.success).toBe(true);
  });

  it('requires a newly rotated refresh token and expiry for self-authorization', () => {
    const result = JumiaSelfAuthorizationTokenResponseSchema.safeParse({
      access_token: 'access-token',
      expires_in: 3600,
      refresh_token: 'refresh-token',
      refresh_expires_in: 86400,
      token_type: 'Bearer',
    });
    expect(result.success).toBe(true);
  });

  it('rejects self-authorization responses that omit either rotated refresh field', () => {
    expect(
      JumiaSelfAuthorizationTokenResponseSchema.safeParse({
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
      }).success
    ).toBe(false);
    expect(
      JumiaSelfAuthorizationTokenResponseSchema.safeParse({
        access_token: 'access-token',
        expires_in: 3600,
        refresh_expires_in: 86400,
        token_type: 'Bearer',
      }).success
    ).toBe(false);
  });

  it('rejects provider tokens that cannot fit credential storage', () => {
    const oversized = 't'.repeat(8193);
    const base = {
      expires_in: 3600,
      refresh_token: 'refresh-token',
      refresh_expires_in: 86400,
      token_type: 'Bearer',
    };

    expect(
      JumiaSelfAuthorizationTokenResponseSchema.safeParse({
        ...base,
        access_token: oversized,
      }).success
    ).toBe(false);
    expect(
      JumiaSelfAuthorizationTokenResponseSchema.safeParse({
        ...base,
        access_token: 'access-token',
        refresh_token: oversized,
      }).success
    ).toBe(false);
    expect(
      JumiaTokenResponseSchema.safeParse({
        access_token: oversized,
        expires_in: 3600,
        token_type: 'Bearer',
      }).success
    ).toBe(false);
  });

  it('accepts max-length tokens that fit credential storage', () => {
    const maxToken = 't'.repeat(8192);

    expect(
      JumiaSelfAuthorizationTokenResponseSchema.safeParse({
        access_token: maxToken,
        expires_in: 3600,
        refresh_token: maxToken,
        refresh_expires_in: 86400,
        token_type: 'Bearer',
      }).success
    ).toBe(true);
  });
});

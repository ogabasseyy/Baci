import { describe, expect, it } from 'vitest';
import { isAdsOAuthStorageProvider } from './contract';
import {
  decryptAdsToken,
  encryptAdsToken,
  timingSafeStringEqual,
} from './crypto';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url');

describe('ads crypto', () => {
  it('encrypts a provider-bound token without serializing its plaintext', () => {
    const ciphertext = encryptAdsToken(
      'opaque-secret-value',
      ENCRYPTION_KEY,
      'meta_ads'
    );

    expect(ciphertext).toMatch(/^v2\.meta_ads\.[^.]+\.[^.]+\.[^.]+$/);
    expect(ciphertext).not.toContain('opaque-secret-value');
    expect(decryptAdsToken(ciphertext, ENCRYPTION_KEY, 'meta_ads')).toBe(
      'opaque-secret-value'
    );
  });

  it('does not decrypt a token for a different provider', () => {
    const ciphertext = encryptAdsToken(
      'opaque-secret-value',
      ENCRYPTION_KEY,
      'meta_ads'
    );

    expect(() =>
      decryptAdsToken(ciphertext, ENCRYPTION_KEY, 'tiktok_ads')
    ).toThrow();
  });

  it('compares state/cookie values without exposing length differences', () => {
    expect(timingSafeStringEqual('same', 'same')).toBe(true);
    expect(timingSafeStringEqual('same', 'different')).toBe(false);
  });

  it('keeps Google on its legacy v1 crypto path', () => {
    expect(isAdsOAuthStorageProvider('google_ads')).toBe(false);
    expect(() =>
      encryptAdsToken(
        'opaque-secret-value',
        ENCRYPTION_KEY,
        'google_ads' as never
      )
    ).toThrow('Google Ads');
  });
});

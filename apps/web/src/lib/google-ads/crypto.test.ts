import { describe, expect, it } from 'vitest';
import {
  createGoogleAdsPkceChallenge,
  decryptGoogleAdsSecret,
  encryptGoogleAdsSecret,
} from './crypto';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url');

describe('Google Ads crypto helpers', () => {
  it('round-trips encrypted provider secrets without returning plaintext format', () => {
    const ciphertext = encryptGoogleAdsSecret('refresh-token', ENCRYPTION_KEY);

    expect(ciphertext).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(ciphertext).not.toContain('refresh-token');
    expect(decryptGoogleAdsSecret(ciphertext, ENCRYPTION_KEY)).toBe(
      'refresh-token'
    );
  });

  it('rejects a ciphertext modified after encryption', () => {
    const ciphertext = encryptGoogleAdsSecret('access-token', ENCRYPTION_KEY);
    const modified = `${ciphertext.slice(0, -1)}${ciphertext.endsWith('a') ? 'b' : 'a'}`;

    expect(() => decryptGoogleAdsSecret(modified, ENCRYPTION_KEY)).toThrow();
  });

  it('builds the RFC 7636 challenge from a verifier', () => {
    expect(createGoogleAdsPkceChallenge('verifier')).toBe(
      'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ'
    );
  });
});

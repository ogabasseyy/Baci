import { describe, expect, it } from 'vitest';
import { isValidAdsTokenEncryptionKey } from './token-encryption-key';

describe('ads token encryption key validation', () => {
  it('accepts exactly 32-byte hex and canonical base64url keys', () => {
    expect(isValidAdsTokenEncryptionKey('a'.repeat(64))).toBe(true);
    expect(
      isValidAdsTokenEncryptionKey(Buffer.alloc(32, 7).toString('base64url'))
    ).toBe(true);
  });

  it('rejects malformed, padded, and wrong-length encodings', () => {
    expect(isValidAdsTokenEncryptionKey('short')).toBe(false);
    expect(isValidAdsTokenEncryptionKey(`${'a'.repeat(64)}0`)).toBe(false);
    expect(
      isValidAdsTokenEncryptionKey(
        `${Buffer.alloc(32, 7).toString('base64url')}=`
      )
    ).toBe(false);
  });
});

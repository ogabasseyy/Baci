import { describe, expect, it } from 'vitest';
import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from './client-credential';

describe('cart client credential contract', () => {
  it('uses a stable header name', () => {
    expect(CART_CLIENT_CREDENTIAL_HEADER).toBe('x-baci-client-credential');
  });

  it('accepts the UUID v4 form clients generate', () => {
    expect(
      isValidCartClientCredential('11111111-1111-4111-8111-111111111111')
    ).toBe(true);
    expect(
      isValidCartClientCredential('22222222-2222-4222-a222-222222222222')
    ).toBe(true);
  });

  it('rejects non-v4, constant, free-form, and non-string values', () => {
    // The nil UUID and other versions are not client credentials.
    expect(
      isValidCartClientCredential('00000000-0000-0000-0000-000000000000')
    ).toBe(false);
    expect(
      isValidCartClientCredential('11111111-1111-1111-8111-111111111111')
    ).toBe(false);
    expect(isValidCartClientCredential('a'.repeat(32))).toBe(false);
    expect(isValidCartClientCredential('Ab3_-x'.repeat(8))).toBe(false);
    expect(isValidCartClientCredential('short')).toBe(false);
    expect(isValidCartClientCredential('')).toBe(false);
    expect(isValidCartClientCredential(null)).toBe(false);
    expect(isValidCartClientCredential(undefined)).toBe(false);
    expect(isValidCartClientCredential(42)).toBe(false);
  });

  it('rejects values that could smuggle header structure', () => {
    expect(isValidCartClientCredential(`${'a'.repeat(31)}\r\n`)).toBe(false);
    expect(isValidCartClientCredential(`${'a'.repeat(31)};`)).toBe(false);
    expect(isValidCartClientCredential(`${'a'.repeat(31)}=`)).toBe(false);
  });
});

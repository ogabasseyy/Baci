import { describe, expect, it } from 'vitest';
import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from './client-credential';

describe('cart client credential contract', () => {
  it('uses a stable header name', () => {
    expect(CART_CLIENT_CREDENTIAL_HEADER).toBe('x-baci-client-credential');
  });

  it('accepts UUID and high-entropy token forms', () => {
    expect(
      isValidCartClientCredential('11111111-1111-4111-8111-111111111111')
    ).toBe(true);
    expect(isValidCartClientCredential('a'.repeat(32))).toBe(true);
    expect(isValidCartClientCredential('Ab3_-x'.repeat(8))).toBe(true);
  });

  it('rejects low-entropy, oversized, and non-string values', () => {
    expect(isValidCartClientCredential('short')).toBe(false);
    expect(isValidCartClientCredential('a'.repeat(65))).toBe(false);
    expect(isValidCartClientCredential('has spaces in it........')).toBe(false);
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

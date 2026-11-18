import { afterEach, describe, expect, it } from 'vitest';
import {
  readCartSessionHint,
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

describe('cart-session-hint', () => {
  afterEach(() => {
    resetCartSessionHintForTests();
  });

  it('returns null when missing or merchantId is empty/whitespace', () => {
    expect(readCartSessionHint(MERCHANT_A)).toBeNull();
    expect(readCartSessionHint('')).toBeNull();
    expect(readCartSessionHint('   ')).toBeNull();
    expect(readCartSessionHint(null)).toBeNull();
    expect(readCartSessionHint(undefined)).toBeNull();
  });

  it('writes and reads "1" and "0" scoped by merchantId without cross-store leakage', () => {
    writeCartSessionHint(MERCHANT_A, '1');
    writeCartSessionHint(MERCHANT_B, '0');

    expect(readCartSessionHint(MERCHANT_A)).toBe('1');
    expect(readCartSessionHint(MERCHANT_B)).toBe('0');

    // Case-insensitive & trimmed merchantId matches the same cookie.
    expect(readCartSessionHint(`  ${MERCHANT_A.toUpperCase()}  `)).toBe('1');
  });

  it('clears the cookie when written with null and ignores invalid values', () => {
    writeCartSessionHint(MERCHANT_A, '1');
    expect(readCartSessionHint(MERCHANT_A)).toBe('1');

    writeCartSessionHint(MERCHANT_A, null);
    expect(readCartSessionHint(MERCHANT_A)).toBeNull();

    document.cookie = `baci-cart-hint-${MERCHANT_A}=invalid; Path=/`;
    expect(readCartSessionHint(MERCHANT_A)).toBeNull();
  });

  it('ignores writes when merchantId is empty or null', () => {
    writeCartSessionHint('', '1');
    writeCartSessionHint(null, '1');
    expect(document.cookie).not.toContain('baci-cart-hint-=');
  });
});

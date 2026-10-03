import { describe, expect, it } from 'vitest';
import { normalizeCurrencyCode } from './normalize-currency-code';

describe('normalizeCurrencyCode', () => {
  it('uppercases a clean code', () => {
    expect(normalizeCurrencyCode('ngn')).toBe('NGN');
  });

  it('trims legacy padding before comparing', () => {
    expect(normalizeCurrencyCode(' NGN ')).toBe('NGN');
  });

  it('never matches a real code for missing or blank values', () => {
    expect(normalizeCurrencyCode(null)).toBe('');
    expect(normalizeCurrencyCode(undefined)).toBe('');
    expect(normalizeCurrencyCode('   ')).toBe('');
  });
});

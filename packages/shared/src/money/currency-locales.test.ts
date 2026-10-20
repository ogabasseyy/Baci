import { describe, expect, it } from 'vitest';
import {
  getMoneyCurrencyExponent,
  getMoneyDisplayExponent,
  MONEY_CURRENCY_EXPONENTS,
  MONEY_CURRENCY_LOCALES,
  normalizeMoneyCurrency,
  resolveMoneyLocale,
  SUPPORTED_MONEY_CURRENCIES,
} from './currency-locales';

describe('currency-locales', () => {
  it('derives locale from the currency code, case-insensitively', () => {
    expect(resolveMoneyLocale('ngn')).toBe('en-NG');
    expect(resolveMoneyLocale('EUR')).toBe('de-DE');
    expect(resolveMoneyLocale('XXX')).toBe('en-NG');
  });

  it('normalizes codes and rejects empty ones', () => {
    expect(normalizeMoneyCurrency(' usd ')).toBe('USD');
    expect(() => normalizeMoneyCurrency('')).toThrow(RangeError);
    expect(() => normalizeMoneyCurrency('   ')).toThrow(RangeError);
  });

  it('pins allowlist exponents and derives others from Intl', () => {
    expect(getMoneyCurrencyExponent('NGN')).toBe(2);
    expect(getMoneyCurrencyExponent('XAF')).toBe(0);
    expect(getMoneyCurrencyExponent('XOF')).toBe(0);
    expect(getMoneyCurrencyExponent('JPY')).toBe(0);
    expect(getMoneyCurrencyExponent('KWD')).toBe(3);
    expect(getMoneyDisplayExponent('JPY')).toBe(0);
    expect(getMoneyDisplayExponent('KWD')).toBe(3);
  });

  it('exposes frozen metadata and the supported list', () => {
    expect(Object.isFrozen(MONEY_CURRENCY_LOCALES)).toBe(true);
    expect(Object.isFrozen(MONEY_CURRENCY_EXPONENTS)).toBe(true);
    expect(SUPPORTED_MONEY_CURRENCIES).toHaveLength(9);
    expect(SUPPORTED_MONEY_CURRENCIES).toContain('NGN');
  });
});

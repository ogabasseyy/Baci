import { describe, expect, it, vi } from 'vitest';
import { getReceiptVatRate } from '../receipt/receipt-money';
import {
  createMoneyFormatter,
  type FormatMoneyOptions,
  formatMoney,
  formatMoneyCompact,
  formatMoneyMinor,
  getMoneyCurrencyExponent,
  getMoneyDisplayExponent,
  MONEY_CURRENCY_EXPONENTS,
  MONEY_CURRENCY_LOCALES,
  normalizeMoneyCurrency,
  resolveMoneyLocale,
  SUPPORTED_MONEY_CURRENCIES,
} from './index';
import { getMoneyFormatter } from './money-formatter';

// Characterization fixtures for the formatting wave (audit row 1). These
// pin, per existing per-app call class, the output the shared formatter
// must produce when that class adopts it:
// - receipt standard: currency-exponent fraction digits
// - mobile-storefront formatPrice: NGN, 0 fraction digits
// - web formatPrice (country-aware): currency-derived locale, 2 digits
// - web utils formatCurrency: minor units in, 0 digits, en-NG
// - mobile-admin merchant/standard: 0 or 2 digits, currency locale
// Outputs are Node ICU output; Hermes parity for allowlisted currencies
// must be verified on-device by the mobile adoption PRs.

const NBSP = '\u00A0';
const NNBSP = '\u202F';

describe('shared money formatting characterization', () => {
  it('pins the standard class per allowlisted currency', () => {
    expect(formatMoney(1234.5, 'NGN')).toBe('₦1,234.50');
    expect(formatMoney(1234.5, 'GHS')).toBe('GH₵1,234.50');
    expect(formatMoney(1234.5, 'KES')).toBe(`Ksh${NBSP}1,234.50`);
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(1234.5, 'GBP')).toBe('£1,234.50');
    expect(formatMoney(1234.5, 'EUR')).toBe(`1.234,50${NBSP}€`);
    expect(formatMoney(1234.5, 'ZAR')).toBe(`R${NBSP}1${NBSP}234,50`);
    // Zero-decimal currencies render no fraction digits by default.
    expect(formatMoney(1234.5, 'XAF')).toBe(`1${NNBSP}235${NBSP}FCFA`);
    expect(formatMoney(1234.5, 'XOF')).toBe(`1${NNBSP}235${NBSP}F${NNBSP}CFA`);
  });

  it('pins zero, negative, and whole-amount (0-digit) outputs', () => {
    expect(formatMoney(0, 'NGN')).toBe('₦0.00');
    expect(formatMoney(-50, 'NGN')).toBe('-₦50.00');
    // mobile-storefront formatPrice class: NGN whole amounts.
    expect(
      formatMoney(1234.5, 'NGN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    ).toBe('₦1,235');
    // mobile-admin orders formatPrice class: merchant currency, 0 digits.
    expect(
      formatMoney(1234.5, 'USD', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    ).toBe('$1,235');
  });

  it('pins the minor-unit class (web utils formatCurrency)', () => {
    expect(
      formatMoneyMinor(123450, 'NGN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    ).toBe('₦1,235');
    expect(formatMoneyMinor(123450, 'NGN')).toBe('₦1,234.50');
  });

  it('does not scale zero-decimal currencies in formatMoneyMinor', () => {
    expect(getMoneyCurrencyExponent('XAF')).toBe(0);
    expect(getMoneyCurrencyExponent('XOF')).toBe(0);
    expect(getMoneyCurrencyExponent('NGN')).toBe(2);
    expect(formatMoneyMinor(123450, 'XOF')).toBe(
      `123${NNBSP}450${NBSP}F${NNBSP}CFA`
    );
    expect(formatMoneyMinor(123450, 'XAF')).toBe(`123${NNBSP}450${NBSP}FCFA`);
  });

  it('pins compact outputs and keeps small amounts standard', () => {
    expect(formatMoneyCompact(1_200_000, 'NGN')).toBe('₦1.2M');
    expect(formatMoneyCompact(3_400_000_000, 'NGN')).toBe('₦3.4B');
    expect(formatMoneyCompact(500, 'NGN')).toBe('₦500.00');
    // Small zero-decimal amounts stay whole in the standard branch.
    expect(formatMoneyCompact(500.5, 'XAF')).toBe(`501${NBSP}FCFA`);
  });

  it('resolves single-bound compact overrides without throwing', () => {
    expect(
      formatMoneyCompact(1_200_000, 'NGN', { maximumFractionDigits: 0 })
    ).toBe('₦1M');
    expect(formatMoneyCompact(500, 'NGN', { minimumFractionDigits: 3 })).toBe(
      '₦500.000'
    );
  });

  it('derives compact defaults from the effective notation', () => {
    // Caller-forced standard notation on a compact-sized amount uses
    // the standard (exponent) defaults, not compact defaults.
    expect(formatMoneyCompact(1200, 'NGN', { notation: 'standard' })).toBe(
      '₦1,200.00'
    );
    // Caller-forced compact notation on a small amount uses compact
    // defaults.
    expect(formatMoneyCompact(500, 'NGN', { notation: 'compact' })).toBe(
      '₦500.0'
    );
  });

  it('ignores explicitly-undefined compact options', () => {
    expect(formatMoneyCompact(1_200_000, 'NGN', { notation: undefined })).toBe(
      '₦1.2M'
    );
    expect(
      formatMoneyCompact(1_200_000, 'NGN', {
        minimumFractionDigits: undefined,
        maximumFractionDigits: undefined,
      })
    ).toBe('₦1.2M');
  });

  it('receipt formatter construction performs no Intl exponent derivation', () => {
    // BHD is non-allowlisted and unused elsewhere in this file, so a
    // derivation would show up as a second Intl.NumberFormat call.
    const spy = vi.spyOn(Intl, 'NumberFormat');
    try {
      createMoneyFormatter('BHD');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('receipt VAT default shares money currency normalization', () => {
    const merchant = {
      vat_rate: null,
      vat_registration_status: 'registered' as const,
    };
    expect(getReceiptVatRate(merchant, ' ngn ')).toBe(7.5);
    expect(getReceiptVatRate(merchant, '')).toBeNull();
  });

  it('exposes frozen currency metadata maps', () => {
    expect(Object.isFrozen(MONEY_CURRENCY_LOCALES)).toBe(true);
    expect(Object.isFrozen(MONEY_CURRENCY_EXPONENTS)).toBe(true);
  });

  it('derives locale from the currency code, case-insensitively', () => {
    expect(resolveMoneyLocale('ngn')).toBe('en-NG');
    expect(resolveMoneyLocale('EUR')).toBe('de-DE');
    expect(normalizeMoneyCurrency(' usd ')).toBe('USD');
    expect(formatMoney(1234.5, 'usd')).toBe('$1,234.50');
    expect(SUPPORTED_MONEY_CURRENCIES).toContain('NGN');
    expect(SUPPORTED_MONEY_CURRENCIES).toHaveLength(9);
  });

  it('createMoneyFormatter matches formatMoney for the same inputs', () => {
    const format = createMoneyFormatter('NGN');
    expect(format(1234.5)).toBe(formatMoney(1234.5, 'NGN'));
    expect(format(0)).toBe('₦0.00');
  });

  it('surfaces structurally invalid currency codes', () => {
    expect(() => formatMoney(1, 'NG')).toThrow(RangeError);
    expect(() => formatMoney(1, '')).toThrow(RangeError);
    expect(() => formatMoney(1, '   ')).toThrow(RangeError);
    expect(() => formatMoneyMinor(1, '')).toThrow(RangeError);
  });

  it('cannot be overridden into another currency via options', () => {
    const rogue = {
      currency: 'USD',
      style: 'decimal',
    } as unknown as FormatMoneyOptions;
    expect(formatMoney(100, 'NGN', rogue)).toBe('₦100.00');
  });

  it('resolves a single fraction-digit bound without throwing', () => {
    expect(formatMoney(100, 'NGN', { maximumFractionDigits: 0 })).toBe('₦100');
    expect(formatMoney(100.5, 'NGN', { minimumFractionDigits: 0 })).toBe(
      '₦100.5'
    );
    expect(formatMoney(100, 'NGN', { minimumFractionDigits: 3 })).toBe(
      '₦100.000'
    );
  });

  it('derives exponents for non-allowlisted currencies from Intl', () => {
    expect(getMoneyCurrencyExponent('JPY')).toBe(0);
    expect(getMoneyCurrencyExponent('KWD')).toBe(3);
    // Display defaults use the same derived exponent as minor-unit
    // scaling for every well-formed code.
    expect(getMoneyDisplayExponent('JPY')).toBe(0);
    expect(getMoneyDisplayExponent('KWD')).toBe(3);
    expect(getMoneyDisplayExponent('XOF')).toBe(0);
    // Zero-exponent JPY minor units are already major units.
    expect(formatMoneyMinor(123450, 'JPY')).toBe(formatMoney(123450, 'JPY'));
    expect(formatMoney(1234.5, 'JPY')).toBe('JP¥1,235');
    expect(formatMoneyMinor(123456, 'KWD')).toBe(`KWD${NBSP}123.456`);
  });

  it('shares one formatter for logically identical options in any order', () => {
    const first = getMoneyFormatter('NGN', {
      currencyDisplay: 'code',
      signDisplay: 'always',
    });
    const second = getMoneyFormatter('NGN', {
      signDisplay: 'always',
      currencyDisplay: 'code',
    });
    expect(second).toBe(first);
  });

  it('pins the receipt class: createMoneyFormatter defaults per currency', () => {
    // Intentional behavior change from the legacy receipt formatter,
    // which forced 2 fraction digits for every currency: XAF/XOF
    // receipts now render whole francs (their ISO exponent is 0).
    expect(createMoneyFormatter('XOF')(1234.5)).toBe(
      `1${NNBSP}235${NBSP}F${NNBSP}CFA`
    );
    expect(createMoneyFormatter('NGN')(1234.5)).toBe('₦1,234.50');
    // Receipt path is table-only: non-allowlisted currencies keep the
    // legacy 2-digit rendering (no on-device Intl exponent derivation),
    // unlike the formatMoney entry point (JPY pin above renders whole).
    expect(createMoneyFormatter('JPY')(1234.5)).toBe('JP¥1,234.50');
    expect(createMoneyFormatter('KWD')(123.456)).toBe(`KWD${NBSP}123.46`);
  });

  it('surfaces an invalid explicit locale instead of masking it', () => {
    expect(() => formatMoney(1, 'USD', { locale: '!!invalid!!' })).toThrow(
      RangeError
    );
  });
});

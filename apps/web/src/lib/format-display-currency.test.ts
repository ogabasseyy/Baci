import { describe, expect, it } from 'vitest';
import { formatDisplayCurrency } from '@/lib/format-display-currency';

describe('formatDisplayCurrency', () => {
  it('formats NGN amounts with two decimals', () => {
    const formatted = formatDisplayCurrency(1500, 'NGN');

    expect(formatted).toContain('1,500.00');
    expect(formatted).toMatch(/NGN|₦/);
  });

  it('normalizes default formatter options consistently', () => {
    expect(formatDisplayCurrency(1500, 'NGN')).toBe(
      formatDisplayCurrency(1500, 'NGN', { currencyDisplay: 'symbol' })
    );
  });

  it('formats zero, negative, and fractional amounts predictably', () => {
    expect(formatDisplayCurrency(0, 'NGN')).toContain('0.00');
    const negativeFormatted = formatDisplayCurrency(-1500, 'NGN');

    expect(negativeFormatted).toContain('1,500.00');
    expect(negativeFormatted).toMatch(/[-−]/);
    expect(formatDisplayCurrency(1500.5, 'NGN')).toContain('1,500.50');
    expect(formatDisplayCurrency(1500.99, 'NGN')).toContain('1,500.99');
  });

  it('formats large numbers and other supported currencies with locale-aware symbols', () => {
    expect(formatDisplayCurrency(1_000_000, 'NGN')).toContain('1,000,000.00');

    const usd = formatDisplayCurrency(250, 'USD');
    const gbp = formatDisplayCurrency(250, 'GBP');

    expect(usd).toContain('250.00');
    expect(usd).toMatch(/USD|\$/);
    expect(gbp).toContain('250.00');
    expect(gbp).toMatch(/GBP|£/);
  });

  it('formats INR with the India locale and supports compact display options', () => {
    const inr = formatDisplayCurrency(123_456, 'INR');
    const compactInr = formatDisplayCurrency(123_456, 'INR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

    expect(inr).toMatch(/₹|INR/);
    expect(inr).toContain('1,23,456.00');
    expect(compactInr).toMatch(/₹|INR/);
    expect(compactInr).toContain('1,23,456');
    expect(compactInr).not.toContain('.00');
  });

  it('preserves zero-decimal currency defaults for JPY', () => {
    const jpy = formatDisplayCurrency(123_456, 'JPY');

    expect(jpy).toMatch(/[¥￥]|JPY/);
    expect(jpy).toContain('123,456');
    expect(jpy).not.toContain('.00');
  });

  it('normalizes invalid or conflicting fraction digit options before constructing Intl formatters', () => {
    expect(() =>
      formatDisplayCurrency(1500, 'NGN', {
        minimumFractionDigits: Number.NaN,
        maximumFractionDigits: Number.POSITIVE_INFINITY,
      })
    ).not.toThrow();

    const conflictingDigits = formatDisplayCurrency(1500, 'NGN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 1,
    });

    expect(conflictingDigits).toContain('1,500.000');
    expect(
      formatDisplayCurrency(1500, 'NGN', {
        minimumFractionDigits: 3,
      })
    ).toContain('1,500.000');
  });

  it('throws for unsupported currency codes', () => {
    expect(() => formatDisplayCurrency(250, 'NOT_REAL')).toThrow();
  });

  it('trims padded legacy currency codes instead of crashing', () => {
    expect(formatDisplayCurrency(100, ' ngn ')).toBe(
      formatDisplayCurrency(100, 'NGN')
    );
  });
});

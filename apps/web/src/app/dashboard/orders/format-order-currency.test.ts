import { describe, expect, it } from 'vitest';
import { formatOrderCurrency } from './format-order-currency';

describe('formatOrderCurrency', () => {
  it('prefers the order currency over the merchant currency', () => {
    expect(formatOrderCurrency(25000, 'KES', 'NG')).toMatch(/ksh\s*25,?000/i);
  });

  it('falls back to the merchant currency when the order has none', () => {
    expect(formatOrderCurrency(25000, null, 'GH')).toMatch(/gh₵|₵\s*25,?000/i);
    expect(formatOrderCurrency(25000, undefined, 'GH')).toMatch(/25,?000/);
    expect(formatOrderCurrency(25000, '  ', 'GH')).toMatch(/25,?000/);
  });

  it('falls back to the merchant currency for a non-ISO order currency', () => {
    expect(formatOrderCurrency(25000, 'XX!', 'NG')).toBe(
      formatOrderCurrency(25000, null, 'NG')
    );
  });

  it('falls back to USD without a merchant country', () => {
    expect(formatOrderCurrency(25000, null, null)).toBe('$25,000.00');
    expect(formatOrderCurrency(25000, undefined, undefined)).toBe('$25,000.00');
  });
});

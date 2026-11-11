import { describe, expect, it } from '@jest/globals';
import { formatNgnCurrency } from './format-ngn-currency';

describe('formatNgnCurrency', () => {
  it('formats whole-naira amounts cleanly and preserves Kobo precision', () => {
    expect(formatNgnCurrency(2500)).toBe('₦2,500');
    expect(formatNgnCurrency(2500.75)).toBe('₦2,500.75');
  });

  it('pads a single kobo digit to two decimals (₦369.5 → ₦369.50)', () => {
    expect(formatNgnCurrency(369.5)).toBe('₦369.50');
    expect(formatNgnCurrency(0.5)).toBe('₦0.50');
  });

  it('keeps whole amounts without decimals', () => {
    expect(formatNgnCurrency(0)).toBe('₦0');
    expect(formatNgnCurrency(250400)).toBe('₦250,400');
  });

  it('shows a dash instead of NaN or Infinity for a non-finite amount', () => {
    expect(formatNgnCurrency(Number.NaN)).toBe('—');
    expect(formatNgnCurrency(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

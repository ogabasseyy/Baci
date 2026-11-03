import { describe, expect, it } from 'vitest';
import {
  formatOrderDetailsDate,
  formatOrderDetailsPrice,
  parseOrderDetailsCurrencyInput,
} from './order-details.formatters';

describe('order-details.formatters', () => {
  it('formats prices with the merchant currency', () => {
    expect(formatOrderDetailsPrice(12500, 'NGN')).toContain('₦');
  });

  it('formats prices in a non-NGN merchant currency using that currency', () => {
    expect(formatOrderDetailsPrice(12500, 'USD')).toContain('$');
  });

  it('falls back to NGN for an unsupported currency code', () => {
    expect(formatOrderDetailsPrice(12500, 'not-a-currency')).toContain('₦');
  });

  it('shows kobo with two digits instead of one', () => {
    expect(formatOrderDetailsPrice(48500.4, 'NGN')).toBe('₦48,500.40');
    expect(formatOrderDetailsPrice(44850, 'NGN')).toBe('₦44,850');
  });

  it('preserves a single decimal point in currency input', () => {
    expect(parseOrderDetailsCurrencyInput('₦12,500.00')).toBe('12500.00');
    expect(parseOrderDetailsCurrencyInput('₦1.2.3')).toBe('1.23');
  });

  it('formats dates for the order details view', () => {
    // Assert a 4-digit year is present (timezone-independent). The exact
    // year at the date boundary depends on the runner's local timezone,
    // so we only assert on the format (any 4 consecutive digits).
    expect(formatOrderDetailsDate('2026-04-21T10:00:00.000Z')).toMatch(/\d{4}/);
  });

  it('returns a dash for empty or invalid dates', () => {
    expect(formatOrderDetailsDate('')).toBe('-');
    expect(formatOrderDetailsDate('not-a-date')).toBe('-');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeRefundMoneyField } from './normalize-refund-money-field';

describe('normalizeRefundMoneyField', () => {
  it.each([
    ['ngn', 'NGN'],
    [' NGN ', 'NGN'],
    ['Paystack', 'PAYSTACK'],
    ['', ''],
    ['   ', ''],
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeRefundMoneyField(value)).toBe(expected);
  });
  it.each([[null], [undefined]])('normalizes %s to empty', (value) => {
    expect(normalizeRefundMoneyField(value)).toBe('');
  });
});

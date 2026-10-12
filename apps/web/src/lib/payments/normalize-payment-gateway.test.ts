import { describe, expect, it } from 'vitest';
import { normalizePaymentGateway } from './normalize-payment-gateway';

describe('normalizePaymentGateway', () => {
  it.each([
    ['paystack', 'PAYSTACK'],
    ['Paystack', 'PAYSTACK'],
    ['PAYSTACK', 'PAYSTACK'],
    [' paystack ', 'PAYSTACK'],
    ['\tPaystack\n', 'PAYSTACK'],
    ['korapay', 'KORAPAY'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePaymentGateway(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
  ])('never matches a missing or blank gateway (%s)', (input) => {
    expect(normalizePaymentGateway(input)).toBe('');
  });

  it('stringifies non-string inputs before normalizing', () => {
    expect(normalizePaymentGateway(42)).toBe('42');
  });
});

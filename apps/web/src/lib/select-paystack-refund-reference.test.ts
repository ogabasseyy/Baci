import { describe, expect, it } from 'vitest';
import { selectPaystackRefundReference } from './select-paystack-refund-reference';

describe('selectPaystackRefundReference', () => {
  it('prefers a usable nested reference', () => {
    expect(selectPaystackRefundReference('PSK-1', 'PAYMENT-1')).toBe('PSK-1');
  });

  it('falls back to the flat reference when the nested value is unusable', () => {
    expect(selectPaystackRefundReference('has space', 'PAYMENT-1')).toBe(
      'PAYMENT-1'
    );
    expect(selectPaystackRefundReference('', 'PAYMENT-1')).toBe('PAYMENT-1');
    expect(selectPaystackRefundReference(123, 'PAYMENT-1')).toBe('PAYMENT-1');
    expect(selectPaystackRefundReference(undefined, 'PAYMENT-1')).toBe(
      'PAYMENT-1'
    );
  });

  it('accepts the full Paystack reference alphabet', () => {
    expect(selectPaystackRefundReference('PSK-1.2=3_4', undefined)).toBe(
      'PSK-1.2=3_4'
    );
    expect(selectPaystackRefundReference(undefined, 'order=7.status')).toBe(
      'order=7.status'
    );
  });

  it('returns undefined when neither reference is usable', () => {
    expect(selectPaystackRefundReference('has space', 'n/a!')).toBeUndefined();
    expect(selectPaystackRefundReference(undefined, undefined)).toBeUndefined();
    expect(
      selectPaystackRefundReference('x'.repeat(101), 'y'.repeat(101))
    ).toBeUndefined();
  });
});

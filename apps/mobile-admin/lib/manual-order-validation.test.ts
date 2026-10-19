import { describe, expect, it } from 'vitest';
import { validateOrderDate } from './manual-order-validation';

const now = new Date('2026-07-02T12:00:00.000Z');

describe('validateOrderDate', () => {
  it('rejects invalid dates', () => {
    expect(() => validateOrderDate(new Date('invalid'), now)).toThrow(
      'Invalid order date'
    );
  });

  it('accepts past and current dates', () => {
    expect(() =>
      validateOrderDate(new Date('2026-07-02T11:59:59.000Z'), now)
    ).not.toThrow();
  });

  it('accepts the exact future tolerance boundary', () => {
    expect(() =>
      validateOrderDate(new Date(now.getTime() + 60_000), now)
    ).not.toThrow();
  });

  it('rejects dates beyond the future tolerance', () => {
    expect(() =>
      validateOrderDate(new Date(now.getTime() + 60_001), now)
    ).toThrow('Order date cannot be in the future');
  });
});

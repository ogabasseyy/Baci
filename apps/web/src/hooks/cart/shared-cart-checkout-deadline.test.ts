import { describe, expect, it } from 'vitest';
import { isSharedCartCheckoutDeadlineExpired } from './shared-cart-checkout-deadline';

describe('isSharedCartCheckoutDeadlineExpired', () => {
  it('expires when the monotonic clock reaches its deadline independently', () => {
    expect(isSharedCartCheckoutDeadlineExpired(100, 1_000, 100, 900)).toBe(
      true
    );
  });

  it('expires when epoch time reaches its deadline independently', () => {
    expect(isSharedCartCheckoutDeadlineExpired(200, 900, 100, 900)).toBe(true);
  });

  it('keeps a review current while both clocks remain before their deadlines', () => {
    expect(isSharedCartCheckoutDeadlineExpired(200, 1_000, 100, 900)).toBe(
      false
    );
  });

  it('fails closed for invalid or missing deadline clock values', () => {
    const invalidCases: readonly Parameters<
      typeof isSharedCartCheckoutDeadlineExpired
    >[] = [
      [Number.NaN, 1_000, 100, 900],
      [200, Number.NaN, 100, 900],
      [200, 1_000, Number.POSITIVE_INFINITY, 900],
      [200, 1_000, 100, Number.NaN],
      [undefined, 1_000, 100, 900],
    ];
    for (const values of invalidCases) {
      expect(isSharedCartCheckoutDeadlineExpired(...values)).toBe(true);
    }
  });
});

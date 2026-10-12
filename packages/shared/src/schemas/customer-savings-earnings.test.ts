import { describe, expect, it } from 'vitest';
import { CustomerSavingsEarningsResponseSchema } from './customer-savings-earnings';

describe('CustomerSavingsEarningsResponseSchema', () => {
  it.each([
    0,
    12550,
    Number.MAX_SAFE_INTEGER,
  ])('accepts safe integer kobo %s', (amount) => {
    expect(
      CustomerSavingsEarningsResponseSchema.parse({
        credited_interest_kobo: amount,
      })
    ).toEqual({ credited_interest_kobo: amount });
  });

  it.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.POSITIVE_INFINITY,
    Number.NaN,
    '12550',
    null,
  ])('rejects unsafe money %s', (amount) => {
    expect(
      CustomerSavingsEarningsResponseSchema.safeParse({
        credited_interest_kobo: amount,
      }).success
    ).toBe(false);
  });

  it('rejects missing fields and unconfirmed accrual fields', () => {
    expect(CustomerSavingsEarningsResponseSchema.safeParse({}).success).toBe(
      false
    );
    expect(
      CustomerSavingsEarningsResponseSchema.safeParse({
        credited_interest_kobo: 0,
        pending_interest_kobo: 100,
      }).success
    ).toBe(false);
  });
});

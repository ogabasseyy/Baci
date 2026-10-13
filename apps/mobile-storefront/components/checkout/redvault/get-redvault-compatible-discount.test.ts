import { describe, expect, it } from '@jest/globals';
import { getRedvaultCompatibleDiscount } from './get-redvault-compatible-discount';

const ordinaryDiscount = {
  code: 'WELCOME10',
  discountAmount: 1_000,
};

describe('bugfix: ordinary checkout discounts must not alter REDVAULT totals', () => {
  it('drops a previously applied ordinary discount after switching to Pay with UBA', () => {
    expect(
      getRedvaultCompatibleDiscount('uba_redvault', ordinaryDiscount)
    ).toBeNull();
  });

  it('preserves an ordinary discount for a compatible payment method', () => {
    expect(getRedvaultCompatibleDiscount('paystack', ordinaryDiscount)).toBe(
      ordinaryDiscount
    );
  });
});

import { describe, expect, it } from 'vitest';
import { readPaystackCheckoutCustomerFeeMinor } from './paystack-checkout-customer-fee';

const certificate = {
  fees: 17_767,
  amount: 517_767,
  requested_amount: 500_000,
  baci_paystack_checkout_customer_fee_minor: 17_767,
};

describe('readPaystackCheckoutCustomerFeeMinor', () => {
  it('returns the fee only when the certified marker and provider amounts agree', () => {
    expect(readPaystackCheckoutCustomerFeeMinor(certificate)).toBe(17_767);
    expect(
      readPaystackCheckoutCustomerFeeMinor({
        fees: certificate.fees,
        amount: certificate.amount,
        requested_amount: certificate.requested_amount,
      })
    ).toBe(0);
  });

  it.each([
    { ...certificate, fees: certificate.fees + 1 },
    { ...certificate, amount: certificate.amount + 1 },
    { ...certificate, requested_amount: 0 },
    { ...certificate, requested_amount: '500000' },
    { ...certificate, amount: Number.MAX_SAFE_INTEGER + 1 },
    { ...certificate, baci_paystack_checkout_customer_fee_minor: Number.NaN },
  ])('returns zero for a mismatching or unsafe certificate (%j)', (response) => {
    expect(readPaystackCheckoutCustomerFeeMinor(response)).toBe(0);
  });
});

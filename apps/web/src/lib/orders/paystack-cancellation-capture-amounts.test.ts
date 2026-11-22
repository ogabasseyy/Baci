import { describe, expect, it } from 'vitest';
import {
  paystackCancellationCaptureAmounts,
  paystackCancellationRefundProviderAmount,
} from './paystack-cancellation-capture-amounts';

const principalMinor = 500_000;
const grossMinor = 517_767;
const certificate = {
  amount: grossMinor,
  requested_amount: principalMinor,
  baci_paystack_checkout_customer_fee_minor: 17_767,
};

describe('paystackCancellationCaptureAmounts', () => {
  it('requires the certified surcharge before treating the charge as greater than principal', () => {
    expect(
      paystackCancellationCaptureAmounts({
        amount: 5000,
        gateway_response: {
          amount: grossMinor,
          requested_amount: principalMinor,
        },
      })
    ).toEqual({ principalMinor, grossMinor: principalMinor });
    expect(
      paystackCancellationCaptureAmounts({
        amount: 5000,
        gateway_response: certificate,
      })
    ).toEqual({ principalMinor, grossMinor });
  });

  it.each([
    { ...certificate, requested_amount: principalMinor - 1 },
    { ...certificate, amount: grossMinor + 1 },
    { ...certificate, amount: Number.MAX_SAFE_INTEGER + 1 },
    { ...certificate, baci_paystack_checkout_customer_fee_minor: '17767' },
    { ...certificate, baci_paystack_checkout_customer_fee_minor: 0 },
  ])('rejects a malformed surcharge certificate (%j)', (gateway_response) => {
    expect(
      paystackCancellationCaptureAmounts({ amount: 5000, gateway_response })
    ).toBeNull();
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])('rejects an unsafe ledger amount %s', (amount) =>
    expect(paystackCancellationCaptureAmounts({ amount })).toBeNull());
});

describe('paystackCancellationRefundProviderAmount', () => {
  it('allows an ordinary partial refund without added provider metadata', () => {
    expect(
      paystackCancellationRefundProviderAmount(
        { amount: 2500 },
        { principalMinor, grossMinor: principalMinor }
      )
    ).toBe(250_000);
    expect(
      paystackCancellationRefundProviderAmount(
        { amount: 2500, metadata: { provider_refund_amount_minor: 300_000 } },
        { principalMinor, grossMinor: principalMinor }
      )
    ).toBeNull();
  });

  it('requires the complete principal and matching gross for a surcharged order', () => {
    const amounts = { principalMinor, grossMinor };
    const metadata = { provider_refund_amount_minor: grossMinor };
    expect(
      paystackCancellationRefundProviderAmount(
        { amount: 5000, metadata },
        amounts
      )
    ).toBe(grossMinor);
    expect(
      paystackCancellationRefundProviderAmount({ amount: 5000 }, amounts)
    ).toBeNull();
    expect(
      paystackCancellationRefundProviderAmount(
        {
          amount: 5000,
          metadata: { provider_refund_amount_minor: principalMinor },
        },
        amounts
      )
    ).toBeNull();
    expect(
      paystackCancellationRefundProviderAmount(
        { amount: 2500, metadata },
        amounts
      )
    ).toBeNull();
    expect(
      paystackCancellationRefundProviderAmount(
        { amount: 5001, metadata },
        amounts
      )
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { readPaystackWalletTopUpAmount } from './paystack-wallet-top-up-amount';

describe('readPaystackWalletTopUpAmount', () => {
  it('bugfix: reads the principal when the customer paid the Paystack fee on top', () => {
    // A ₦1,000 top-up where Paystack charged the customer ₦1,015 (₦15 fee).
    expect(
      readPaystackWalletTopUpAmount({
        amount: 101_500,
        requested_amount: 100_000,
        fees: 1_500,
      })
    ).toBe(1_000);
  });

  it('reads the charged amount when the merchant bears the fee', () => {
    expect(
      readPaystackWalletTopUpAmount({
        amount: 100_000,
        requested_amount: 100_000,
        fees: 1_500,
      })
    ).toBe(1_000);
  });

  it('reads the charged amount when Paystack sends no requested amount', () => {
    expect(readPaystackWalletTopUpAmount({ amount: 250_000 })).toBe(2_500);
  });

  it.each([
    { amount: 101_500, requested_amount: 100_000, fees: 1_400 },
    { amount: 101_500, requested_amount: 100_000 },
    { amount: 101_500, requested_amount: '100000', fees: 1_500 },
    { amount: 101_500, requested_amount: 0, fees: 101_500 },
    { amount: 101_500, requested_amount: 100_000, fees: Number.NaN },
  ])('keeps the gross amount when the fee split is not proven (%j)', (response) => {
    expect(readPaystackWalletTopUpAmount(response)).toBe(1_015);
  });

  it.each([
    {},
    { amount: '101500' },
    { amount: 0 },
    { amount: -100 },
    { amount: 1.5 },
  ])('returns null without a usable charged amount (%j)', (response) => {
    expect(readPaystackWalletTopUpAmount(response)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { isGiglShippingRetainingPaymentMethod } from './gigl-shipping-retention-payment-methods';

describe('isGiglShippingRetainingPaymentMethod', () => {
  it.each([
    'card',
    ' Paystack ',
    'juicyway',
    'klump',
    'wallet',
    'store_credit',
  ])('treats %s as retaining', (method) => {
    expect(isGiglShippingRetainingPaymentMethod(method)).toBe(true);
  });

  it.each([
    'credit_direct',
    'oxygen',
    'bank_transfer',
    'pod',
    'newpay',
    '',
    null,
    undefined,
  ])('treats %s as non-retaining (fail-safe)', (method) => {
    expect(isGiglShippingRetainingPaymentMethod(method)).toBe(false);
  });
});

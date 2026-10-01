import { describe, expect, it } from 'vitest';
import { mapOrderFinancialFields } from './order-financials';

describe('mapOrderFinancialFields', () => {
  it('maps persisted order payment fields to numeric values', () => {
    expect(
      mapOrderFinancialFields({
        discount_amount: '1000',
        gift_wrapping_fee: 0,
        shipping_fee: '1500',
        subtotal: '10000',
        tax_amount: '750',
        tax_basis: 'exclusive',
      })
    ).toEqual({
      discount_amount: 1000,
      gift_wrapping_fee: 0,
      shipping_fee: 1500,
      subtotal: 10000,
      tax_amount: 750,
      tax_basis: 'exclusive',
    });
  });

  it('omits unavailable or invalid payment fields', () => {
    expect(
      mapOrderFinancialFields({
        discount_amount: '1000junk',
        gift_wrapping_fee: null,
        shipping_fee: undefined,
        subtotal: '   ',
        tax_amount: Number.NaN,
        tax_basis: 'unknown',
      })
    ).toEqual({
      discount_amount: undefined,
      gift_wrapping_fee: undefined,
      shipping_fee: undefined,
      subtotal: undefined,
      tax_amount: undefined,
      tax_basis: undefined,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { getCheckoutGiglPaidShippingFee } from './order-checkout-gigl-paid-fee';

const order = {
  payment_method: 'paystack',
  payment_status: 'paid',
  selected_quote_id: 'quote-1',
  shipment_id: null,
  shipping_fee: 4500,
  shipping_funding_source: 'customer_checkout',
  shipping_provider: 'gigl',
  tracking_number: null,
};

describe('getCheckoutGiglPaidShippingFee', () => {
  it('returns the fee the customer paid for a saved checkout GIG quote', () => {
    expect(getCheckoutGiglPaidShippingFee(order)).toBe(4500);
  });

  it('accepts a payment method stored in another case', () => {
    expect(
      getCheckoutGiglPaidShippingFee({ ...order, payment_method: ' Paystack ' })
    ).toBe(4500);
  });

  it.each([
    ['no order', undefined],
    ['another provider', { ...order, shipping_provider: 'TOPSHIP' }],
    [
      'a merchant-wallet quote',
      { ...order, shipping_funding_source: 'merchant_wallet' },
    ],
    ['a cleared quote', { ...order, selected_quote_id: null }],
    ['a booked shipment', { ...order, shipment_id: 'shipment-1' }],
    ['free shipping', { ...order, shipping_fee: 0 }],
    ['a missing fee', { ...order, shipping_fee: null }],
    // customer_checkout is stamped when the order is created, before payment.
    ['an unpaid order', { ...order, payment_status: 'unpaid' }],
    ['a pending payment', { ...order, payment_status: 'pending' }],
    ['a partly paid order', { ...order, payment_status: 'partially_paid' }],
    ['an approved BNPL order', { ...order, payment_status: 'bnpl_approved' }],
    ['a refunded order', { ...order, payment_status: 'refunded' }],
    // Booking refuses these methods: Baci holds no shipping money for them.
    ['pay on delivery', { ...order, payment_method: 'pay_on_delivery' }],
    ['the pod alias', { ...order, payment_method: 'POD' }],
    ['Credit Direct', { ...order, payment_method: 'credit_direct' }],
    ['the credit-direct alias', { ...order, payment_method: 'credit-direct' }],
    ['a manual payment', { ...order, payment_method: 'manual_payment' }],
    ['cash', { ...order, payment_method: 'cash' }],
  ])('returns null for %s', (_case, candidate) => {
    expect(getCheckoutGiglPaidShippingFee(candidate)).toBeNull();
  });
});

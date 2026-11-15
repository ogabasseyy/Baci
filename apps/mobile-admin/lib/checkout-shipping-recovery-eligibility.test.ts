import { describe, expect, it } from 'vitest';
import { canUseCheckoutShippingRecovery } from './checkout-shipping-recovery-eligibility';

const order = {
  merchant_id: 'merchant',
  payment_status: 'paid',
  shipping_status: 'processing',
  shipping_funding_source: 'customer_checkout',
  shipping_provider: 'GIGL',
  shipment_id: null,
  tracking_number: null,
} as const;
const merchant = { id: 'merchant' };
describe('checkout shipping recovery UI eligibility', () => {
  it('allows a user who can book GIG to review an unbooked paid checkout order', () => {
    expect(canUseCheckoutShippingRecovery(order, merchant, true)).toBe(true);
  });
  it.each([
    [false, merchant],
    [true, null],
    [true, { id: 'other' }],
  ])('rejects recovery rights %s for merchant %j', (canRecover, context) => {
    expect(canUseCheckoutShippingRecovery(order, context, canRecover)).toBe(
      false
    );
  });
  it.each([
    { payment_status: 'pending' },
    { shipping_status: 'shipped' },
    { shipping_funding_source: 'merchant_wallet' },
    { shipping_provider: 'TOPSHIP' },
    { shipment_id: 'booked' },
    { tracking_number: 'tracked' },
  ] as const)('rejects an ineligible order %j', (changes) => {
    expect(
      canUseCheckoutShippingRecovery({ ...order, ...changes }, merchant, true)
    ).toBe(false);
  });
  it('rejects an unavailable order', () => {
    expect(canUseCheckoutShippingRecovery(undefined, merchant, true)).toBe(
      false
    );
  });
});
